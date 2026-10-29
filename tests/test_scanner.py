import unittest
from copy import deepcopy
from unittest.mock import Mock, patch
from test_qr_update import Database, QrService, AssetRepository
from infrastructure.scanner_codes import normalize_ean, code_values


class ScannerTests(unittest.TestCase):
    def test_optional_independent_codes(self):
        self.assertEqual(code_values({}), {})
        self.assertEqual(code_values({"qr_code": "", "ean": None}), {"qr_code": None, "ean": None})
        self.assertEqual(code_values({"qr_code": "QR-1", "ean": "4006381333931"}), {"qr_code": "QR-1", "ean": "4006381333931"})

    def test_ean_formats_and_leading_zeroes(self):
        for code in ("4006381333931", "96385074", "0012345678905"):
            self.assertEqual(normalize_ean(code), code)
        for code in ("4006381333932", "96385075", "123", "abcdefgh", 4006381333931, "１２３４５６７８"):
            with self.subTest(code=code), self.assertRaises(ValueError): normalize_ean(code)

    def test_qr_and_ean_find_same_stock_and_book(self):
        db = Database()
        db.rows["product_models"][0].update(qr_code="QR-NEW", ean="4006381333931")
        service = QrService(db, actor_email="admin@example.test")
        qr = service.lookup("QR-NEW", "qr")["matches"]
        ean = service.lookup("4006381333931", "ean")["matches"]
        self.assertEqual(qr, ean)
        result = service.adjust({"code": "4006381333931", "product_model_id": 10, "storage_location_id": 3, "condition": "used", "quantity": 2, "direction": "remove"})
        self.assertEqual(result["quantity"], 3)

    def test_duplicate_ean_returns_all_devices(self):
        db = Database()
        first = db.rows["assets"][0]
        first.update(qr_code="ASSET-QR", ean="96385074")
        db.rows["assets"].append({**first, "id": 2, "asset_tag": "PC-002", "qr_code": None})
        self.assertEqual({row["key"] for row in QrService(db).lookup("96385074", "ean")["matches"]}, {"asset:1", "asset:2"})
        self.assertEqual(len(QrService(db).lookup("ASSET-QR")["matches"]), 1)

    def test_model_ean_finds_associated_serialized_devices(self):
        db = Database()
        db.rows["product_models"].append({"id": 11, "name": "Notebook", "tracking_mode": "serialized", "is_active": True, "ean": "96385074"})
        self.assertEqual(QrService(db).lookup("96385074", "ean")["matches"][0]["key"], "asset:1")

    def test_save_model_codes_keeps_sku_and_part_number(self):
        db = Database(); before = deepcopy(db.rows["product_models"][0])
        QrService(db).save_model_codes(10, {"qr_code": "INTERNAL", "ean": "0012345678905"})
        model = db.rows["product_models"][0]
        self.assertEqual(model["sku"], before["sku"])
        self.assertEqual(model["ean"], "0012345678905")
        QrService(db).save_model_codes(10, {"qr_code": None})
        self.assertIsNone(model["qr_code"])
        self.assertEqual(model["ean"], "0012345678905")

    def test_existing_model_code_not_overwritten_by_new_article(self):
        db = Database(); db.rows["product_models"][0]["ean"] = "96385074"
        with self.assertRaisesRegex(ValueError, "bereits einen anderen"):
            QrService(db).save_model_codes(10, {"ean": "4006381333931"}, only_empty=True)
        self.assertEqual(db.writes, [])

    def test_unknown_ean_never_replaces_internal_asset_tag(self):
        repo = AssetRepository(Mock())
        payload = {"scanner_codes": {"qr_code": None, "ean": "4006381333931"}, "model": {"mode": "existing", "id": 1}, "asset": {"asset_tag": "IT-123", "purchase_date": "2026-10-22"}, "assignment": {"department_id": 2}}
        with patch.object(repo, "_resolve_or_create_product_model", return_value=(1, "serialized", None, None)), patch.object(repo, "_validate_location_department"), patch.object(repo, "_create_serialized_asset", return_value={"id": 1}) as create:
            repo.create_inventory_entry(payload)
        self.assertEqual(create.call_args.kwargs["asset_data"]["asset_tag"], "IT-123")
        self.assertEqual(create.call_args.kwargs["asset_data"]["ean"], "4006381333931")

    def test_invalid_ean_rejected_before_any_db_call(self):
        db = Mock(); repo = AssetRepository(db)
        with self.assertRaises(ValueError): repo.create_inventory_entry({"scanner_codes": {"ean": "4006381333932"}})
        db.table.assert_not_called()

    def test_new_api_and_old_api_require_editor_to_book(self):
        from fastapi.testclient import TestClient
        from types import SimpleNamespace
        from web_backend.app import app, get_web_session
        db=Database()
        app.dependency_overrides[get_web_session]=lambda: SimpleNamespace(client=db,email="viewer@example.test",role="viewer")
        try:
            with TestClient(app) as client:
                self.assertEqual(client.get("/api/scanner/lookup", params={"code":"PC-001"}).status_code,200)
                self.assertEqual(client.get("/api/qr/lookup", params={"code":"PC-001"}).status_code,200)
                self.assertEqual(client.get("/api/scanner/lookup", params={"code":"96385075","code_type":"ean"}).status_code,400)
                self.assertEqual(client.post("/api/scanner/stock",json={}).status_code,403)
        finally: app.dependency_overrides.clear()
