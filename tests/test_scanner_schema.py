"""Regression für den Bearbeitungsfehler bei noch fehlender QR-/EAN-Erweiterung."""
import unittest
from copy import deepcopy
from types import SimpleNamespace

from test_qr_update import Database, Query
from infrastructure.asset_repository import AssetRepository
from infrastructure.qr_service import QrService
from infrastructure.scanner_schema import (
    missing_scanner_column, select_scanner_compatible, write_scanner_compatible,
)
from web_backend.product_model_routes import ProductModelService


class SchemaError(Exception):
    def __init__(self, message, code="42703"):
        self.message, self.code = message, code
        super().__init__(message)


class LegacyQuery(Query):
    def __init__(self, client, table):
        super().__init__(client, table)
        self.columns, self.filter_columns = "*", []

    def select(self, columns): self.columns = columns; return self
    def eq(self, key, value): self.filter_columns.append(key); return super().eq(key, value)
    def is_(self, key, value): self.filter_columns.append(key); return super().is_(key, value)
    def neq(self, key, value): self.filters.append(lambda row: str(row.get(key)) != str(value)); return self

    def execute(self):
        if self.table in {"assets", "product_models"}:
            selected = self.columns.split(",") + self.filter_columns
            for field in ("qr_code", "ean"):
                if field in selected:
                    raise SchemaError(f"column {self.table}.{field} does not exist")
                if self.payload is not None and field in self.payload:
                    raise SchemaError(f"Could not find the '{field}' column of '{self.table}' in the schema cache", "PGRST204")
        result = super().execute()
        if self.operation == "select" and self.columns != "*":
            result.data = [{key: row.get(key) for key in self.columns.split(",")} for row in result.data]
        return result


class LegacyDatabase(Database):
    def __init__(self):
        super().__init__()
        self.rows["product_models"].append({
            "id": 11, "name": "Notebook", "manufacturer_id": 1, "category_id": 1,
            "tracking_mode": "serialized", "is_active": True, "specifications": {},
        })
        self.rows["product_categories"] = [{"id": 1, "name": "Laptop", "code": "laptop", "inventory_group": "device", "specification_schema": {}}]
        self.rows["manufacturers"] = [{"id": 1, "name": "Hersteller"}]
        self.rows["assets"][0].update(purchase_date="2026-10-01", specifications={})

    def table(self, name): return LegacyQuery(self, name)


class ScannerSchemaTests(unittest.TestCase):
    def test_create_and_edit_form_read_without_scanner_columns(self):
        repository = AssetRepository(LegacyDatabase())
        form = repository.load_create_form_data()
        self.assertEqual(len(form["product_models"]), 2)
        edit = repository.load_edit_form_data({"_record_type": "asset", "id": 1})
        self.assertEqual(edit["edit_entry"]["asset_tag"], "PC-001")
        self.assertNotIn("qr_code", edit["edit_entry"])

    def test_edit_existing_asset_with_empty_codes_preserves_data(self):
        db = LegacyDatabase()
        payload = {
            "edit": {"record_type": "asset", "id": 1},
            "model": {"mode": "existing", "id": 11},
            "condition": "used", "storage_location_id": 3,
            "scanner_codes": {"qr_code": None, "ean": None},
            "asset": {"asset_tag": "PC-001", "purchase_date": "2026-10-01", "note": "Bearbeitet", "status": "available"},
            "assignment": {"department_id": 2},
        }
        AssetRepository(db).update_inventory_entry(payload)
        asset = db.rows["assets"][0]
        self.assertEqual(asset["note"], "Bearbeitet")
        self.assertEqual(asset["serial_number"], None)
        self.assertNotIn("qr_code", asset)
        self.assertNotIn("ean", asset)

    def test_model_management_loads_and_edits_without_scanner_columns(self):
        db = LegacyDatabase(); service = ProductModelService(db)
        self.assertEqual(len(service.load()["product_models"]), 2)
        service.update("11", {"name": "Notebook aktualisiert", "qr_code": None, "ean": None})
        self.assertEqual(db.rows["product_models"][1]["name"], "Notebook aktualisiert")

    def test_legacy_codes_keep_working(self):
        service = QrService(LegacyDatabase())
        self.assertEqual(service.lookup("PC-001")["matches"][0]["key"], "asset:1")
        self.assertEqual(service.lookup("QR-CABLE")["matches"][0]["product_model_id"], 10)

    def test_empty_model_codes_do_not_block_stock(self):
        db=LegacyDatabase()
        QrService(db).save_model_codes(10, {"qr_code": None, "ean": None})
        self.assertEqual(db.writes, [])

    def test_populated_code_is_never_silently_dropped(self):
        db=LegacyDatabase()
        with self.assertRaisesRegex(ValueError, "database/scanner_codes.sql"):
            write_scanner_compatible(lambda values: db.table("assets").update(values).eq("id",1), "assets", {"note":"Nicht speichern", "ean":"96385074"})
        self.assertEqual(db.writes, [])

    def test_migrated_schema_preserves_both_codes(self):
        db=Database()
        write_scanner_compatible(lambda values: db.table("assets").update(values).eq("id",1), "assets", {"qr_code":"QR-1", "ean":"96385074"})
        self.assertEqual(db.rows["assets"][0]["ean"],"96385074")
        self.assertEqual(db.rows["assets"][0]["qr_code"],"QR-1")

    def test_unrelated_errors_are_not_hidden_or_retried(self):
        for error in (SchemaError("column product_models.name does not exist"), SchemaError("permission denied", "42501"), ConnectionError("offline")):
            calls=[]
            def factory(columns):
                calls.append(columns)
                class Failure:
                    def execute(self): raise error
                return Failure()
            with self.subTest(error=error), self.assertRaises(type(error)):
                select_scanner_compatible(factory,"product_models","id,name,qr_code,ean")
            self.assertEqual(len(calls),1)

    def test_missing_column_requires_correct_table_and_code(self):
        self.assertIsNone(missing_scanner_column(SchemaError("column assets.qr_code does not exist"),"product_models"))
        self.assertIsNone(missing_scanner_column(SchemaError("column product_models.qr_code does not exist","42501"),"product_models"))

    def test_partial_upgrade_does_not_drop_supported_values(self):
        payloads=[]
        class Partial:
            def __init__(self, values): self.values=values
            def execute(self):
                payloads.append(deepcopy(self.values))
                if "ean" in self.values: raise SchemaError("Could not find the 'ean' column of 'assets' in the schema cache","PGRST204")
                return SimpleNamespace(data=[self.values])
        result=write_scanner_compatible(Partial,"assets",{"qr_code":"QR-1","ean":None})
        self.assertEqual(result.data,[{"qr_code":"QR-1"}])
        self.assertEqual(len(payloads),2)
