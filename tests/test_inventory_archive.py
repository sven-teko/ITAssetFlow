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
        row = {"id": "stock:101:11:used", "_record_type": "stock", "product_model_id": 101,
               "storage_location_id": 11, "condition": "used"}
        with patch("web_backend.app.AssetRepository") as repo:
            repo.return_value.load_inventory.return_value = [row]
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
