"""Regressionstests ohne Zugang zur produktiven Datenbank.

Start im Projektordner: python -m unittest discover -s tests -v
"""
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from infrastructure.date_validation import normalize_date, normalize_inventory_dates
from infrastructure.asset_repository import AssetRepository
from web_backend.settings_routes import SettingsService


class FakeQuery:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.filters, self.operation, self.payload = [], "select", None

    def select(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def insert(self, payload):
        self.operation, self.payload = "insert", deepcopy(payload)
        return self

    def update(self, payload):
        self.operation, self.payload = "update", deepcopy(payload)
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def execute(self):
        rows = self.client.rows.setdefault(self.table, [])
        matching = [row for row in rows if all(str(row.get(k)) == str(v) for k, v in self.filters)]
        if self.operation == "insert":
            row = {"id": max([item.get("id", 0) for item in rows] or [0]) + 1, **self.payload}
            rows.append(row)
            matching = [row]
        elif self.operation == "update":
            for row in matching:
                row.update(self.payload)
        elif self.operation == "delete":
            self.client.rows[self.table] = [row for row in rows if row not in matching]
        if self.operation != "select":
            self.client.writes.append((self.table, self.operation, deepcopy(self.payload)))
        return SimpleNamespace(data=deepcopy(matching))


class FakeClient:
    def __init__(self, rows=None):
        self.rows, self.writes = deepcopy(rows or {}), []

    def table(self, name):
        return FakeQuery(self, name)


def employee(**changes):
    return {
        "id": None, "first_name": "Test", "last_name": "Person", "email": "test@example.test",
        "employee_number": "E-1", "department_ref": "id:10", "is_active": True,
        **changes,
    }


class DateTests(unittest.TestCase):
    def test_iso_and_swiss_dates(self):
        for raw in ("2028-02-29", "29.02.2028", "29-02-2028", " 2028-02-29 "):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_date(raw, "Garantie bis"), "2028-02-29")

    def test_invalid_calendar_and_incomplete_dates(self):
        for raw in ("2027-02-29", "2026-04-31", "26-10-21", "20261021", "2026-1-1", "10000-01-01", "0000-01-01", "2026-13-01"):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, "vierstelliger"):
                normalize_date(raw, "Garantie bis")

    def test_empty_warranty_is_optional(self):
        for value in (None, "", "   "):
            self.assertIsNone(normalize_date(value, "Garantie bis"))

    def test_purchase_is_required(self):
        with self.assertRaisesRegex(ValueError, "Kaufdatum fehlt"):
            normalize_inventory_dates({"asset": {"warranty_until": "2028-01-01"}})

    def test_warranty_cannot_precede_purchase(self):
        with self.assertRaisesRegex(ValueError, "vor dem Kaufdatum"):
            normalize_inventory_dates({"asset": {"purchase_date": "2026-10-21", "warranty_until": "2026-10-20"}})

    def test_same_day_and_past_warranty_are_valid(self):
        for warranty in ("2020-01-01", "2021-01-01"):
            result = normalize_inventory_dates({"asset": {"purchase_date": "2020-01-01", "warranty_until": warranty}})
            self.assertEqual(result["asset"]["warranty_until"], warranty)

    def test_input_is_not_mutated(self):
        payload = {"asset": {"purchase_date": "21.10.2026", "warranty_until": ""}}
        result = normalize_inventory_dates(payload)
        self.assertEqual(payload["asset"]["purchase_date"], "21.10.2026")
        self.assertEqual(result["asset"]["purchase_date"], "2026-10-21")
        self.assertIsNone(result["asset"]["warranty_until"])

    def test_invalid_create_does_not_write_even_new_model(self):
        client = Mock()
        with self.assertRaises(ValueError):
            AssetRepository(client).create_inventory_entry({"model": {"mode": "new"}, "asset": {"purchase_date": "2026-01-01", "warranty_until": "2025-01-01"}})
        client.table.assert_not_called()

    def test_invalid_edit_does_not_query_or_write(self):
        client = Mock()
        with self.assertRaises(ValueError):
            AssetRepository(client).update_inventory_entry({"asset": {"purchase_date": "2026-02-30"}})
        client.table.assert_not_called()

    def test_normalized_dates_reach_create_and_edit(self):
        repo = AssetRepository(Mock())
        payload = {"entry_type": "asset", "model": {"mode": "existing", "id": 1}, "asset": {"purchase_date": "21.10.2026", "warranty_until": "21.10.2028"}, "assignment": {"department_id": 10}, "edit": {"record_type": "asset", "id": 2}}
        with patch.object(repo, "_resolve_or_create_product_model", return_value=(1, "serialized", None, None)), patch.object(repo, "_validate_location_department"), patch.object(repo, "_create_serialized_asset", return_value={"id": 2}) as create, patch.object(repo, "_update_serialized_asset", return_value={"id": 2}) as update:
            repo.create_inventory_entry(payload)
            repo.update_inventory_entry(payload)
            for call in (create, update):
                self.assertEqual(call.call_args.kwargs["asset_data"]["warranty_until"], "2028-10-21")


class EmployeeTests(unittest.TestCase):
    def test_new_employee_uses_department_and_cannot_grant_login(self):
        client = FakeClient()
        SettingsService(client).save({"employees": [employee(app_role="admin", auth_user_id="spoofed")]})
        row = client.rows["employees"][0]
        self.assertEqual(row["department_id"], 10)
        self.assertNotIn("auth_user_id", row)
        self.assertNotIn("app_role", row)

    def test_invalid_employee_is_rejected_before_site_write(self):
        client = FakeClient()
        with self.assertRaisesRegex(ValueError, "Vorname"):
            SettingsService(client).save({"sites": [{"name": "New site"}], "employees": [employee(first_name="")]})
        self.assertEqual(client.writes, [])

    def test_duplicate_numbers_and_emails_are_rejected(self):
        for change in ({"email": "other@example.test"}, {"employee_number": "E-2"}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "doppelt"):
                SettingsService(FakeClient()).save({"employees": [employee(), employee(**change)]})

    def test_department_temporary_reference_is_resolved(self):
        client = FakeClient()
        SettingsService(client)._save_employees([employee(department_ref="new:department:1")], {"new:department:1": 77})
        self.assertEqual(client.rows["employees"][0]["department_id"], 77)

    def test_unassigned_employee_is_supported(self):
        client = FakeClient()
        SettingsService(client).save({"employees": [employee(department_ref=None)]})
        self.assertIsNone(client.rows["employees"][0]["department_id"])

    def test_own_admin_cannot_be_disabled_or_demoted(self):
        current = {"id": 1, "email": "admin@example.test", "auth_user_id": "auth-1", "app_role": "admin"}
        for change in ({"is_active": False}, {"app_role": "viewer"}):
            client = FakeClient({"employees": [current]})
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "Administratorkonto"):
                SettingsService(client, actor_email="ADMIN@example.test").save({"employees": [employee(**{"id": 1, "email": current["email"], "app_role": "admin", **change})]})
            self.assertEqual(client.writes, [])

    def test_login_email_cannot_be_replaced(self):
        client = FakeClient({"employees": [{"id": 1, "email": "admin@example.test", "auth_user_id": "auth-1", "app_role": "admin"}]})
        with self.assertRaisesRegex(ValueError, "E-Mail"):
            SettingsService(client).save({"employees": [employee(id=1, email="changed@example.test")]})
        self.assertEqual(client.writes, [])

    def test_employee_update_preserves_existing_auth_link(self):
        client = FakeClient({"employees": [{"id": 1, "email": "test@example.test", "auth_user_id": "auth-1", "app_role": "user"}]})
        SettingsService(client).save({"employees": [employee(id=1, department_ref="id:20", app_role="viewer")]})
        self.assertEqual(client.rows["employees"][0]["auth_user_id"], "auth-1")
        self.assertEqual(client.rows["employees"][0]["department_id"], 20)


class ApiTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from web_backend.app import app, get_web_session
        self.app = app
        self.db = Mock()
        self.session = SimpleNamespace(client=self.db, email="admin@example.test", role="admin")
        app.dependency_overrides[get_web_session] = lambda: self.session
        self.client = TestClient(app)

    def tearDown(self):
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_invalid_warranty_is_http_400_without_database_access(self):
        response = self.client.post("/api/inventory", json={"asset": {
            "purchase_date": "2026-10-21", "warranty_until": "2026-10-20",
        }})
        self.assertEqual(response.status_code, 400)
        self.assertIn("vor dem Kaufdatum", response.json()["detail"])
        self.db.table.assert_not_called()

    def test_viewer_cannot_read_settings_or_write_inventory(self):
        self.session.role = "viewer"
        for method, url in (("get", "/api/settings"), ("put", "/api/settings"), ("post", "/api/inventory")):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, **({"json": {}} if method != "get" else {}))
                self.assertEqual(response.status_code, 403)
        self.db.table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
