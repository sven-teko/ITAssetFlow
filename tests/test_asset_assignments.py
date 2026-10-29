"""Mitarbeiterzuweisungen über die vollständigen Anlege-/Bearbeitungspfade."""
from copy import deepcopy
import unittest

from test_qr_update import Database, Query
from infrastructure.asset_repository import AssetRepository


class AssignmentQuery(Query):
    def neq(self, key, value):
        self.filters.append(lambda row: str(row.get(key)) != str(value))
        return self

    def execute(self):
        if self.table in ("asset_assignments", "asset_locations") and self.operation == "insert":
            self.payload.setdefault("valid_from", "2026-10-29T15:00:00+00:00")
            self.payload.setdefault("valid_to", None)
        if self.table == "asset_assignments" and self.operation == "insert":
            # Dieselben Ziel- und Eindeutigkeitsregeln wie in der Datenbank.
            target_count = sum(self.payload.get(key) is not None for key in ("employee_id", "department_id"))
            if target_count != 1:
                raise ValueError("asset_assignments_exact_target_ck")
            if self.payload["valid_to"] is None and any(
                row["asset_id"] == self.payload["asset_id"] and row.get("valid_to") is None
                for row in self.client.rows.get(self.table, [])
            ):
                raise ValueError("asset_assignments_current_uq")
        return super().execute()


class AssignmentDatabase(Database):
    def __init__(self):
        super().__init__()
        self.rows["product_models"].append({"id": 11, "tracking_mode": "serialized", "name": "Test PC"})
        self.rows["employees"][0]["department_id"] = 2
        self.rows["employees"].append({"id": 8, "department_id": 2, "is_active": True})
        self.rows["asset_assignments"] = [{
            "id": 50, "asset_id": 1, "employee_id": None, "department_id": 2,
            "valid_from": "2026-01-01", "valid_to": None,
        }]

    def table(self, name):
        return AssignmentQuery(self, name)


class AssetAssignmentTests(unittest.TestCase):
    def setUp(self):
        self.db = AssignmentDatabase()
        self.repo = AssetRepository(self.db)
        self.payload = {
            "entry_type": "asset", "edit": {"record_type": "asset", "id": 1},
            "model": {"mode": "existing", "id": 11}, "condition": "used",
            "storage_location_id": 3,
            "asset": {"asset_tag": "PC-001", "purchase_date": "2026-01-01", "status": "available"},
            "assignment": {"employee_id": 7, "department_id": 2},
        }

    def current(self, asset_id=1):
        rows = [row for row in self.db.rows["asset_assignments"]
                if row["asset_id"] == asset_id and row.get("valid_to") is None]
        self.assertEqual(len(rows), 1)
        return rows[0]

    def test_edit_assigns_employee_and_keeps_location_context_on_reopen(self):
        original = deepcopy(self.payload)
        self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.current()["employee_id"], 7)
        self.assertIsNone(self.current()["department_id"])
        self.assertIsNotNone(self.db.rows["asset_assignments"][0]["valid_to"])
        self.assertEqual(self.payload, original)
        edit = self.repo.load_edit_form_data({"id": 1, "_record_type": "asset"})["edit_entry"]
        self.assertEqual(edit["assigned_employee_id"], 7)
        self.assertEqual(edit["department_id"], 2)
        self.assertEqual(edit["site_id"], 1)

    def test_unchanged_employee_does_not_create_assignment_history(self):
        self.repo.update_inventory_entry(self.payload)
        before = deepcopy(self.db.rows["asset_assignments"])
        self.db.writes.clear()
        self.payload["asset"]["note"] = "Nur die Notiz geändert"
        self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.db.rows["asset_assignments"], before)
        self.assertFalse(any(table == "asset_assignments" for table, *_ in self.db.writes))

    def test_employee_can_be_replaced_and_removed(self):
        self.repo.update_inventory_entry(self.payload)
        self.payload["assignment"]["employee_id"] = 8
        self.repo.update_inventory_entry(self.payload)
        self.assertEqual(self.current()["employee_id"], 8)
        self.assertIsNone(self.current()["department_id"])
        self.payload["assignment"]["employee_id"] = None
        self.repo.update_inventory_entry(self.payload)
        self.assertIsNone(self.current()["employee_id"])
        self.assertEqual(self.current()["department_id"], 2)
        self.assertEqual(len(self.db.rows["asset_assignments"]), 4)

    def test_create_supports_employee_or_department_assignment(self):
        for employee_id, tag in ((7, "NEW-EMPLOYEE"), (None, "NEW-DEPARTMENT")):
            with self.subTest(employee_id=employee_id):
                self.payload["assignment"]["employee_id"] = employee_id
                self.payload["asset"]["asset_tag"] = tag
                result = self.repo.create_inventory_entry(self.payload)
                assignment = self.current(result["id"])
                self.assertEqual(assignment["employee_id"], employee_id)
                self.assertEqual(assignment["department_id"], 2 if employee_id is None else None)

    def test_department_and_location_still_have_to_match(self):
        self.payload["assignment"]["department_id"] = 99
        for method in (self.repo.create_inventory_entry, self.repo.update_inventory_entry):
            with self.subTest(method=method.__name__), self.assertRaisesRegex(ValueError, "Abteilung"):
                method(self.payload)
        self.assertEqual(self.db.writes, [])


if __name__ == "__main__":
    unittest.main()
