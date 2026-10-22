import sys
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from infrastructure.qr_service import QrService, normalize_qr_code
from infrastructure.asset_repository import AssetRepository
from web_backend.settings_routes import SettingsService
from test_update import FakeClient, employee


class Query:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.filters, self.operation, self.payload = [], "select", None
        self.bounds, self.sort, self.maximum = None, None, None

    def select(self, *_args): return self
    def eq(self, key, value): self.filters.append(lambda r: str(r.get(key)) == str(value)); return self
    def is_(self, key, _value): self.filters.append(lambda r: r.get(key) is None); return self
    def in_(self, key, values): self.filters.append(lambda r: r.get(key) in values); return self
    def ilike(self, key, value):
        raw = value.replace(r"\%", "%").replace(r"\_", "_").replace(r"\*", "*").replace("\\\\", "\\")
        self.filters.append(lambda r: str(r.get(key) or "").casefold() == raw.casefold())
        return self
    def range(self, start, end): self.bounds = (start, end + 1); return self
    def order(self, key, desc=False): self.sort = (key, desc); return self
    def limit(self, count): self.maximum = count; return self
    def update(self, payload): self.operation, self.payload = "update", deepcopy(payload); return self
    def insert(self, payload): self.operation, self.payload = "insert", deepcopy(payload); return self

    def execute(self):
        rows = self.client.rows.setdefault(self.table, [])
        matching = [row for row in rows if all(check(row) for check in self.filters)]
        if self.operation == "insert":
            row = {"id": 100 + len(rows), **self.payload}
            if self.table == "stock_movements":
                location = row.get("to_storage_location_id") or row.get("from_storage_location_id")
                condition = row.get("to_condition") or row.get("from_condition")
                levels = self.client.rows.setdefault("stock_levels", [])
                level = next((item for item in levels if item["product_model_id"] == row["product_model_id"] and item["storage_location_id"] == location and item["condition"] == condition), None)
                if level is None:
                    level = {"product_model_id": row["product_model_id"], "storage_location_id": location, "condition": condition, "quantity": 0}
                    levels.append(level)
                delta = row["quantity"] * (1 if row.get("to_storage_location_id") else -1)
                if level["quantity"] + delta < 0: raise ValueError("Nicht genügend Lagerbestand")
                level["quantity"] += delta
            rows.append(row); matching = [row]
            self.client.writes.append((self.table, self.operation, deepcopy(self.payload)))
        elif self.operation == "update":
            for row in matching: row.update(self.payload)
            self.client.writes.append((self.table, self.operation, deepcopy(self.payload)))
        if self.sort:
            key, desc = self.sort
            matching = sorted(matching, key=lambda row: row.get(key, 0), reverse=desc)
        if self.maximum is not None: matching = matching[:self.maximum]
        if self.bounds: matching = matching[self.bounds[0]:self.bounds[1]]
        return SimpleNamespace(data=deepcopy(matching))


class Database:
    def __init__(self):
        self.writes = []
        self.rows = {
            "product_models": [{"id": 10, "name": "USB-Kabel", "sku": "QR-CABLE", "tracking_mode": "quantity", "is_active": True}],
            "assets": [{"id": 1, "asset_tag": "PC-001", "serial_number": "SER-1", "product_model_id": 11, "condition": "used", "status": "available"}],
            "sites": [{"id": 1, "name": "Basel"}],
            "departments": [{"id": 2, "name": "IT", "site_id": 1}],
            "storage_locations": [{"id": 3, "name": "Lager", "site_id": 1, "department_id": 2, "is_active": True}],
            "stock_levels": [{"product_model_id": 10, "storage_location_id": 3, "condition": "used", "quantity": 5}],
            "stock_movements": [],
            "asset_locations": [{"id": 1, "asset_id": 1, "storage_location_id": 3, "valid_from": "2026-01-01", "valid_to": None}],
            "employees": [{"id": 7, "email": "admin@example.test", "is_active": True}],
        }
    def table(self, name): return Query(self, name)


class OptionalEmailTests(unittest.TestCase):
    def test_multiple_employees_without_email(self):
        db = FakeClient()
        SettingsService(db).save({"employees": [employee(email="", employee_number="E-1"), employee(email="", employee_number="E-2")]})
        self.assertEqual([row["email"] for row in db.rows["employees"]], [None, None])

    def test_blank_email_remains_optional_on_edit(self):
        db = FakeClient({"employees": [{"id": 1, "email": None, "auth_user_id": None}]})
        SettingsService(db).save({"employees": [employee(id=1, email="   ")]})
        self.assertIsNone(db.rows["employees"][0]["email"])


class QrTests(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.service = QrService(self.db, actor_email="admin@example.test")
        self.booking = {"code": "QR-CABLE", "product_model_id": 10, "storage_location_id": 3, "condition": "used", "quantity": 2, "direction": "add"}

    def test_unknown_code_has_no_match_and_writes_nothing(self):
        self.assertEqual(self.service.lookup("NEW-001")["matches"], [])
        self.assertEqual(self.db.writes, [])

    def test_asset_tag_and_serial_are_recognized(self):
        for code in ("PC-001", "SER-1"):
            with self.subTest(code=code):
                match = self.service.lookup(code)["matches"][0]
                self.assertEqual(match["key"], "asset:1")
                self.assertEqual(match["quantity"], 1)

    def test_sku_case_insensitive_and_zero_balance_recognized(self):
        self.db.rows["stock_levels"][0]["quantity"] = 0
        match = self.service.lookup("qr-cable")["matches"][0]
        self.assertEqual(match["quantity"], 0)
        self.assertEqual(match["record_type"], "stock")

    def test_model_without_movements_can_receive_stock(self):
        self.db.rows["stock_levels"] = []
        match = self.service.lookup("QR-CABLE")["matches"][0]
        self.assertIsNone(match["storage_location_id"])
        self.assertEqual(self.service.adjust(self.booking)["quantity"], 2)

    def test_increase_records_one_receipt_with_actor(self):
        result = self.service.adjust(self.booking)
        self.assertEqual(result["quantity"], 7)
        self.assertEqual(len(self.db.writes), 1)
        row = self.db.rows["stock_movements"][0]
        self.assertEqual(row["movement_type"], "receipt")
        self.assertEqual(row["performed_by_employee_id"], 7)
        self.assertIsNone(row["from_storage_location_id"])

    def test_remove_all_preserves_movement_history(self):
        result = self.service.adjust({**self.booking, "quantity": 5, "direction": "remove"})
        self.assertEqual(result["quantity"], 0)
        self.assertEqual(self.db.rows["stock_movements"][0]["movement_type"], "issue")
        self.assertEqual(self.service.lookup("QR-CABLE")["matches"][0]["quantity"], 0)

    def test_too_large_removal_writes_nothing(self):
        with self.assertRaisesRegex(ValueError, "Nicht genügend"):
            self.service.adjust({**self.booking, "quantity": 6, "direction": "remove"})
        self.assertEqual(self.db.writes, [])

    def test_invalid_quantities_rejected(self):
        for quantity in (0, -1, "NaN", "Infinity", 1.5, 1000001, None):
            with self.subTest(quantity=quantity), self.assertRaises(ValueError):
                self.service.adjust({**self.booking, "quantity": quantity})
        self.assertEqual(self.db.writes, [])

    def test_code_and_model_must_match(self):
        with self.assertRaisesRegex(ValueError, "stimmen nicht"):
            self.service.adjust({**self.booking, "product_model_id": 999})
        self.assertEqual(self.db.writes, [])

    def test_inactive_location_rejected(self):
        self.db.rows["storage_locations"][0]["is_active"] = False
        with self.assertRaisesRegex(ValueError, "aktiven Lagerort"):
            self.service.adjust(self.booking)
        self.assertEqual(self.db.writes, [])

    def test_qr_binding_preserves_existing_sku(self):
        with self.assertRaisesRegex(ValueError, "bereits eine andere"):
            self.service.bind_model_code(10, "NEW-CODE")
        self.assertEqual(self.db.writes, [])

    def test_unassigned_model_accepts_qr_binding(self):
        self.db.rows["product_models"][0]["sku"] = None
        self.service.bind_model_code(10, "NEW-CODE")
        self.assertEqual(self.db.rows["product_models"][0]["sku"], "NEW-CODE")

    def test_saved_booking_does_not_fail_if_followup_read_fails(self):
        real_table = self.db.table
        calls = 0
        def table(name):
            nonlocal calls
            if name == "stock_levels":
                calls += 1
                raise ConnectionError("test followup failure")
            return real_table(name)
        with patch.object(self.db, "table", side_effect=table):
            result = self.service.adjust(self.booking)
        self.assertTrue(result["saved"])
        self.assertIsNone(result["quantity"])
        self.assertEqual(len(self.db.writes), 1)

    def test_invalid_qr_text(self):
        for value in ("", "A\nB", "X" * 101, None):
            with self.subTest(value=value), self.assertRaises(ValueError): normalize_qr_code(value)

    def test_unknown_qr_prefills_serialized_identifier_on_server(self):
        repo = AssetRepository(Mock())
        payload = {"qr_code": "NEW-QR", "model": {"mode": "existing", "id": 1}, "asset": {"asset_tag": "ignored", "purchase_date": "2026-10-22"}, "assignment": {"department_id": 2}}
        with patch.object(repo, "_resolve_or_create_product_model", return_value=(1, "serialized", None, None)), patch.object(repo, "_validate_location_department"), patch.object(repo, "_create_serialized_asset", return_value={"id": 1}) as create:
            repo.create_inventory_entry(payload)
        self.assertEqual(create.call_args.kwargs["asset_data"]["asset_tag"], "NEW-QR")

    def test_new_stock_article_binds_code_before_initial_receipt(self):
        self.db.rows["product_models"][0]["sku"] = None
        repo = AssetRepository(self.db)
        payload = {"qr_code": "NEW-STOCK", "model": {"mode": "existing", "id": 10}, "stock": {"quantity": 2, "purchase_date": "2026-10-22", "department_id": 2}}
        with patch.object(repo, "_resolve_or_create_product_model", return_value=(10, "quantity", None, None)), patch.object(repo, "_validate_location_department"), patch.object(repo, "_create_stock_receipt", return_value={"id": 1, "quantity": 2}) as create:
            repo.create_inventory_entry(payload)
        self.assertEqual(self.db.rows["product_models"][0]["sku"], "NEW-STOCK")
        self.assertEqual(create.call_args.kwargs["stock_data"]["quantity"], 2)

    def test_new_quantity_model_receives_qr_as_sku(self):
        repo = AssetRepository(self.db)
        payload = {"qr_code": "NEW-STOCK", "model": {"mode": "new", "tracking_mode": "quantity"}, "stock": {"quantity": 2, "purchase_date": "2026-10-22", "department_id": 2}}
        with patch.object(repo, "_resolve_or_create_product_model", return_value=(10, "quantity", None, None)) as resolve, patch.object(repo, "_validate_location_department"), patch.object(QrService, "bind_model_code"), patch.object(repo, "_create_stock_receipt", return_value={"id": 1, "quantity": 2}):
            repo.create_inventory_entry(payload)
        self.assertEqual(resolve.call_args.args[0]["sku"], "NEW-STOCK")
        self.assertNotIn("sku", payload["model"])

    def test_viewer_cannot_book_qr_stock(self):
        from fastapi.testclient import TestClient
        from web_backend.app import app, get_web_session
        app.dependency_overrides[get_web_session] = lambda: SimpleNamespace(client=self.db, email="viewer@example.test", role="viewer")
        try:
            with TestClient(app) as client:
                self.assertEqual(client.post("/api/qr/stock", json=self.booking).status_code, 403)
        finally: app.dependency_overrides.clear()
        self.assertEqual(self.db.writes, [])


if __name__ == "__main__": unittest.main()
