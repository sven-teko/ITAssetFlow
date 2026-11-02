"""Bestandsbearbeitung mit unveränderlicher Bewegungshistorie."""
from copy import deepcopy
import unittest

from test_qr_update import Database, Query
from infrastructure.asset_repository import AssetRepository


class StockQuery(Query):
    @property
    def not_(self):
        query = self
        class Negated:
            def is_(self, key, _value):
                query.filters.append(lambda row: row.get(key) is not None)
                return query
        return Negated()

    def execute(self):
        if self.table == "stock_movements":
            if self.operation == "update":
                raise ValueError("Lagerbewegungen dürfen nachträglich nicht geändert oder gelöscht werden.")
            if self.operation == "insert":
                if isinstance(self.payload, list):
                    previous, writes = deepcopy(self.client.rows), deepcopy(self.client.writes)
                    try:
                        data = []
                        for row in self.payload:
                            data.extend(StockQuery(self.client, self.table).insert(row).execute().data)
                        from types import SimpleNamespace
                        return SimpleNamespace(data=data)
                    except Exception:
                        self.client.rows, self.client.writes = previous, writes
                        raise
                if self.payload.get("to_storage_location_id") == self.client.reject_location:
                    raise ValueError("Zielbuchung abgelehnt")
                self.payload.setdefault("moved_at", "2026-11-02T10:00:00+00:00")
        return super().execute()


class StockDatabase(Database):
    reject_location = -1

    def __init__(self):
        super().__init__()
        self.rows["stock_movements"] = [{
            "id": 1, "product_model_id": 10, "to_storage_location_id": 3, "to_condition": "used",
            "quantity": 5, "movement_type": "receipt", "department_id": 2,
            "purchase_date": "2026-10-01", "new_price": 10, "status": "available",
            "note": "Alt", "moved_at": "2026-10-01T10:00:00+00:00",
        }]
        self.rows["storage_locations"].append({"id": 4, "name": "Ziel", "site_id": 1, "department_id": 2})

    def table(self, name):
        return StockQuery(self, name)


class StockEditTests(unittest.TestCase):
    def setUp(self):
        self.db = StockDatabase()
        self.repo = AssetRepository(self.db)
        self.original = deepcopy(self.db.rows["stock_movements"][0])
        self.payload = {
            "edit": {"record_type": "stock", "product_model_id": 10, "storage_location_id": 3,
                     "condition": "used", "stock_quantity": 5, "source_movement_id": 1},
            "model": {"mode": "existing", "id": 10}, "condition": "used", "storage_location_id": 3,
            "stock": {"quantity": 5, "department_id": 2, "purchase_date": "2026-10-01",
                      "new_price": 10, "status": "available", "note": "Alt"},
        }

    def test_increase_and_decrease_append_only_adjustments(self):
        for quantity, direction, difference in ((8, "to", 3), (2, "from", 3)):
            with self.subTest(quantity=quantity):
                self.setUp()
                self.payload["stock"].update(quantity=quantity, note="Neu")
                self.repo.update_inventory_entry(self.payload)
                self.assertEqual(self.db.rows["stock_movements"][0], self.original)
                self.assertEqual(len(self.db.rows["stock_movements"]), 2)
                row = self.db.rows["stock_movements"][-1]
                self.assertEqual(row["movement_type"], "adjustment")
                self.assertEqual(row["quantity"], difference)
                self.assertEqual(row[f"{direction}_storage_location_id"], 3)
                self.assertEqual(self.db.rows["stock_levels"][0]["quantity"], quantity)
                reopened = self.repo.load_edit_form_data({"_record_type": "stock", "product_model_id": 10,
                            "storage_location_id": 3, "condition": "used"})["edit_entry"]
                self.assertEqual(reopened["stock_quantity"], quantity)
                self.assertEqual(reopened["note"], "Neu")

    def test_unchanged_entry_does_not_write_history(self):
        self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.db.writes, [])

    def test_metadata_change_keeps_quantity_and_history(self):
        self.payload["stock"]["note"] = "Neue Notiz"
        self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.db.rows["stock_movements"][0], self.original)
        self.assertEqual(len(self.db.rows["stock_movements"]), 3)
        self.assertEqual(self.db.rows["stock_levels"][0]["quantity"], 5)
        self.assertEqual(self.repo._latest_stock_metadata(10, 3, "used")["note"], "Neue Notiz")

    def test_move_is_one_atomic_batch(self):
        self.payload["storage_location_id"] = 4
        self.payload["stock"]["quantity"] = 6
        self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.db.rows["stock_movements"][0], self.original)
        self.assertEqual([row["quantity"] for row in self.db.rows["stock_levels"]], [0, 6])

    def test_failed_target_preserves_original_stock(self):
        self.db.reject_location = 4
        self.payload["storage_location_id"] = 4
        with self.assertRaisesRegex(ValueError, "Zielbuchung"):
            self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.db.rows["stock_levels"][0]["quantity"], 5)
        self.assertEqual(self.db.rows["stock_movements"], [self.original])
        self.assertEqual(self.db.writes, [])

    def test_stale_quantity_and_invalid_values_do_not_write(self):
        self.payload["edit"]["stock_quantity"] = 4
        with self.assertRaisesRegex(ValueError, "inzwischen geändert"):
            self.repo.update_inventory_entry(self.payload)
        self.payload["edit"]["stock_quantity"] = 5
        for value in (0, -1, "NaN", "Infinity"):
            self.payload["stock"]["quantity"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.db.writes, [])


if __name__ == "__main__":
    unittest.main()
