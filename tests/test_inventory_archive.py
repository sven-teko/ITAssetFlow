"""Archivpflicht, Rollen und begrenzte Bildübertragung über die echte Web-API."""
import base64
from types import SimpleNamespace
from unittest.mock import patch
import unittest

import test_update
from test_qr_update import Database
from infrastructure.qr_service import QrService
from infrastructure.scanner_codes import normalize_mac


class ArchiveApiTests(unittest.TestCase):
    def setUp(self):
        test_update.ApiTests.setUp(self)
        self.db.rpc.return_value.execute.return_value = SimpleNamespace(data={"deleted_count": 1})

    def tearDown(self):
        test_update.ApiTests.tearDown(self)

    def test_reason_required_without_database_changes(self):
        for reason in (None, {"reason": "customer"}, {"reason": "defective"}, {"reason": "other", "note": "  "}):
            body = {"entry_keys": ["asset:1"]}
            if reason is not None:
                body["reason"] = reason
            self.assertEqual(self.client.post("/api/inventory/delete", json=body).status_code, 422)
        self.db.rpc.assert_not_called()

    def test_quantity_selection_translates_to_canonical_archive_key(self):
        with patch("infrastructure.asset_repository.AssetRepository.load_inventory", side_effect=AssertionError("Inventar erneut geladen")):
            response = self.client.post("/api/inventory/delete", json={
                "entry_keys": ["stock:stock:101:11:used:101:11:used"],
                "reason": {"reason": "defective", "destroyed": False},
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.db.rpc.assert_called_once_with("archive_inventory_items", {
            "p_keys": ["stock:101:11:used"],
            "p_reason": {"reason": "defective", "destroyed": False, "customer_name": None, "note": None},
        })

    def test_viewer_can_read_archive_but_cannot_archive_or_write_images(self):
        self.session.role = "viewer"
        query = self.db.table.return_value.select.return_value.order.return_value.order.return_value.range.return_value
        query.execute.return_value = SimpleNamespace(data=[], count=0)
        self.assertEqual(self.client.get("/api/archive").json(), {"items": [], "total": 0})
        for method, path, kwargs in (
            ("post", "/api/inventory/delete", {"json": {"entry_keys": ["asset:1"], "reason": {"reason": "lost"}}}),
            ("post", "/api/inventory/asset:1/image", {"content": b"invalid", "headers": {"Content-Type": "image/webp"}}),
            ("delete", "/api/inventory/asset:1/image", {}),
        ):
            self.assertEqual(getattr(self.client, method)(path, **kwargs).status_code, 403)
        self.db.rpc.assert_not_called()

    def test_image_size_and_format_are_checked_before_rpc(self):
        for content, mime, status in ((b"x", "image/png", 415), (b"x"*24, "image/webp", 400),
                                      (b"x"*(1048576+1), "image/webp", 413)):
            response = self.client.post("/api/inventory/asset:1/image", content=content, headers={"Content-Type": mime})
            self.assertEqual(response.status_code, status)
        self.db.rpc.assert_not_called()

    def test_no_session_no_archive_or_images(self):
        self.app.dependency_overrides.clear()
        self.assertEqual(self.client.get("/api/archive").status_code, 401)
        self.assertEqual(self.client.get("/api/images/00000000-0000-0000-0000-000000000001").status_code, 401)

    def test_archive_delete_only_for_admin_and_only_selected_row(self):
        archive_id = "00000000-0000-0000-0000-000000000001"
        url = f"/api/archive/{archive_id}"
        for role in ("viewer", "user"):
            self.session.role = role
            self.assertEqual(self.client.delete(url).status_code, 403)
        self.db.table.assert_not_called()
        self.session.role = "admin"
        self.assertEqual(self.client.delete("/api/archive/invalid").status_code, 422)
        query = self.db.table.return_value.delete.return_value
        query.eq.return_value.execute.return_value = SimpleNamespace(data=[{"id": archive_id}])
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.db.table.assert_called_once_with("inventory_archive")
        query.eq.assert_called_once_with("id", archive_id)
        query.eq.return_value.execute.return_value = SimpleNamespace(data=[])
        self.assertEqual(self.client.delete(url).status_code, 404)

    def test_archive_restore_for_editor_and_returns_changed_stock(self):
        archive_id = "00000000-0000-0000-0000-000000000001"
        url = f"/api/archive/{archive_id}/restore"
        self.session.role = "viewer"
        self.assertEqual(self.client.post(url).status_code, 403)
        self.db.rpc.assert_not_called()
        self.session.role = "user"
        result = {"restored": True, "quantity": 2, "key": "stock:101:11:used"}
        self.db.rpc.return_value.execute.return_value = SimpleNamespace(data=result)
        self.assertEqual(self.client.post(url).json(), result)
        self.db.rpc.assert_called_once_with("restore_inventory_archive", {"p_archive_id": archive_id})
        for code, expected in (("P0001", 409), ("P0002", 404), ("42501", 403)):
            error = RuntimeError("Rücknahme nicht möglich")
            error.code = code
            error.message = str(error)
            self.db.rpc.return_value.execute.side_effect = error
            self.assertEqual(self.client.post(url).status_code, expected)

    def test_inventory_operations_use_role_and_canonical_stock_key(self):
        from uuid import uuid4
        payload = {"request_id": str(uuid4()), "entry_key": "stock:stock:101:11:used:101:11:used",
                   "destination_id": 22, "quantity": 3, "expected_quantity": 10}
        self.session.role = "viewer"
        self.assertEqual(self.client.post("/api/inventory/move", json=payload).status_code, 403)
        self.assertEqual(self.client.post("/api/inventory/stock", json={}).status_code, 403)
        self.db.rpc.assert_not_called()
        self.session.role = "user"
        error = RuntimeError("Der Lagerbestand wurde inzwischen geändert.")
        error.code = "40001"
        error.details = "8.000"
        self.db.rpc.return_value.execute.side_effect = error
        response = self.client.post("/api/inventory/move", json=payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["available"], 8)
        fn, args = self.db.rpc.call_args.args
        self.assertEqual(fn, "move_inventory_entry")
        self.assertEqual(args["p_key"], "stock:101:11:used")
        self.assertEqual(args["p_destination"], 22)

    def test_archive_filters_are_validated_and_forwarded(self):
        self.db.rpc.return_value.execute.return_value = SimpleNamespace(data={"items": [], "total": 0})
        url = "/api/archive?site=Basel&q=aabbcc112233&reason=lost&date_from=2026-11-02&date_until=2026-11-03"
        self.assertEqual(self.client.get(url).status_code, 200)
        self.db.rpc.assert_called_once_with("search_inventory_archive", {
            "p_offset": 0, "p_query": "aabbcc112233", "p_site": "Basel", "p_reason": "lost",
            "p_from": "2026-11-02", "p_until": "2026-11-03",
        })
        self.assertEqual(self.client.get("/api/archive?date_from=2026-11-03&date_until=2026-11-02").status_code, 422)

    def test_unconfirmed_stock_reduction_returns_dialog_signal(self):
        from decimal import Decimal
        from infrastructure.stock_booking import StockWithdrawalRequired
        with patch("web_backend.app.AssetRepository") as repo:
            repo.return_value.update_inventory_entry.side_effect = StockWithdrawalRequired(Decimal(5))
            response = self.client.put("/api/inventory", json={})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "stock_withdrawal_required")
        self.assertEqual(response.json()["detail"]["available"], 5)

    def test_image_response_is_not_cached(self):
        content = b"test-image"
        self.db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(
            data=[{"image_data": base64.b64encode(content).decode(), "content_type": "image/webp"}])
        response = self.client.get("/api/images/00000000-0000-0000-0000-000000000001")
        self.assertEqual(response.content, content)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")


class ScannerIdentifierTests(unittest.TestCase):
    def test_mac_spellings_normalize_and_match_stored_asset(self):
        db = Database()
        db.rows["assets"][0]["mac_address"] = "AA:BB:CC:11:22:33"
        for code in ("aabbcc112233", "aa-bb-cc-11-22-33", "aabb.cc11.2233", "MAC: AA:BB:CC:11:22:33"):
            self.assertEqual(normalize_mac(code), "AA:BB:CC:11:22:33")
            result = QrService(db).lookup(code)
            self.assertEqual(result["code_type"], "mac")
            self.assertEqual(result["matches"][0]["key"], "asset:1")

    def test_mac_stored_as_product_identifier_matches_other_spellings(self):
        db = Database()
        db.rows["assets"][0]["asset_tag"] = "aAbB.Cc11.2233"
        result = QrService(db).lookup("AA-BB-CC-11-22-33")
        self.assertEqual(result["code_type"], "asset_tag")
        self.assertEqual(result["matches"][0]["key"], "asset:1")

    def test_arbitrary_serial_and_archived_asset_exclusion(self):
        db = Database()
        for serial in ("SER/42-abc", "000001234567", "ABCDEF112233"):
            db.rows["assets"][0]["serial_number"] = serial
            result = QrService(db).lookup(serial)
            self.assertEqual(result["code_type"], "serial")
            self.assertEqual(result["matches"][0]["serial_number"], serial)
        db.rows["assets"][0]["archived_at"] = "2026-11-02T12:00:00Z"
        self.assertEqual(QrService(db).lookup(serial)["matches"], [])


if __name__ == "__main__":
    unittest.main()
