"""Export-Downloads, vollständige Seiten und unveränderte Benutzerrechte."""
import csv
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from infrastructure.data_transfer_service import DataTransferService


class ExportQuery:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.keys, self.bounds = [], None

    def select(self, columns, *, count):
        assert columns == "*" and count == "exact"
        return self

    def order(self, key):
        self.keys.append(key)
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def execute(self):
        self.client.calls.append((self.table, self.bounds))
        if self.client.failure:
            raise self.client.failure
        # Der Client stellt ausschliesslich die durch RLS sichtbaren Zeilen bereit.
        rows = [row for row in self.client.rows.get(self.table, []) if row.get("_visible", True)]
        rows.sort(key=lambda row: tuple(row[key] for key in self.keys))
        start, end = self.bounds
        page = rows[start:min(end + 1, start + self.client.cap)]
        return SimpleNamespace(data=deepcopy(page), count=len(rows))


class ExportClient:
    def __init__(self, rows=None, cap=500, failure=None):
        self.rows, self.cap, self.failure = deepcopy(rows or {}), cap, failure
        self.calls = []

    def table(self, name):
        return ExportQuery(self, name)


class ExportTests(unittest.TestCase):
    def test_pagination_handles_more_than_1000_rows_and_lower_server_limit(self):
        client = ExportClient({"assets": [{"id": i} for i in range(1205, 0, -1)]}, cap=137)
        snapshot = DataTransferService(client)._load_snapshot()
        self.assertEqual([row["id"] for row in snapshot["assets"]], list(range(1, 1206)))
        self.assertEqual(len([call for call in client.calls if call[0] == "assets"]), 9)

    def test_csv_and_sql_preserve_codes_json_and_only_visible_rows(self):
        row = {"id": 1, "asset_tag": "PC-'01", "qr_code": "SER-0001", "ean": "0012345678905",
               "note": "ÄÖÜ;\nZweite Zeile", "specifications": {"ram": 32}}
        client = ExportClient({"assets": [row, {"id": 2, "asset_tag": "VERBORGEN", "_visible": False}],
                               "employee_site_access": [{"employee_id": 7, "site_id": 1}]})
        with tempfile.TemporaryDirectory() as directory:
            service = DataTransferService(client)
            csv_path, sql_path = Path(directory) / "data.csv", Path(directory) / "data.sql"
            for method, path in ((service.export_csv, csv_path), (service.export_postgresql, sql_path)):
                result = method(path)
                self.assertEqual(result["exported_rows"], 2)
                self.assertNotIn("VERBORGEN", path.read_text(encoding="utf-8-sig"))
            self.assertTrue(csv_path.read_bytes().startswith(b"\xef\xbb\xbf"))
            with csv_path.open(encoding="utf-8-sig", newline="") as handle:
                records = list(csv.DictReader(handle))
            asset = next(record for record in records if record["table"] == "assets")
            self.assertEqual(json.loads(asset["row_json"]), row)
            payloads = [service._decode_payload(line.removeprefix("-- ITASSETFLOW-DATA "), 1)
                        for line in sql_path.read_text().splitlines() if line.startswith("-- ITASSETFLOW-DATA ")]
            self.assertEqual(next(item["row"] for item in payloads if item["table"] == "assets"), row)

    def test_generated_columns_are_computed_by_postgresql(self):
        client = ExportClient({"stock_counts": [{"id": 1, "expected_quantity": 2,
                                "counted_quantity": 1, "difference_quantity": -1}]})
        row = DataTransferService(client)._load_snapshot()["stock_counts"][0]
        self.assertNotIn("difference_quantity", row)
        self.assertEqual(row["counted_quantity"], 1)


class ExportApiTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from web_backend.app import app, get_web_session
        self.app, self.dependency = app, get_web_session
        self.db = ExportClient({"assets": [{"id": 1, "asset_tag": "SICHTBAR"},
                                          {"id": 2, "asset_tag": "VERBORGEN", "_visible": False}]})
        self.session = SimpleNamespace(client=self.db, email="viewer@example.test", role="viewer")
        app.dependency_overrides[get_web_session] = lambda: self.session
        self.http = TestClient(app)

    def tearDown(self):
        self.app.dependency_overrides.clear()
        self.http.close()

    def test_both_downloads_use_current_session_and_clean_temporary_files(self):
        created, real = [], tempfile.NamedTemporaryFile

        def temporary(*args, **kwargs):
            handle = real(*args, **kwargs)
            created.append(Path(handle.name))
            return handle

        with patch("web_backend.app.tempfile.NamedTemporaryFile", side_effect=temporary):
            for role in ("viewer", "user", "admin"):
                self.session.role = role
                for format, suffix, mime in (("csv", ".csv", "text/csv"), ("postgresql", ".sql", "application/sql")):
                    with self.subTest(role=role, format=format):
                        response = self.http.get(f"/api/transfer/export/{format}", headers={"Origin": "http://localhost:5173"})
                        self.assertEqual(response.status_code, 200)
                        self.assertIn(suffix, response.headers["content-disposition"])
                        self.assertTrue(response.headers["content-type"].startswith(mime))
                        self.assertEqual(response.headers["cache-control"], "no-store")
                        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
                        self.assertIn("Content-Disposition", response.headers["access-control-expose-headers"])
                        self.assertIn("SICHTBAR", response.text)
                        self.assertNotIn("VERBORGEN", response.text)
        self.assertEqual(len(created), 6)
        self.assertTrue(all(not path.exists() for path in created))

    def test_export_failure_returns_error_and_removes_partial_file(self):
        self.db.failure = RuntimeError("permission denied for table assets")
        with tempfile.TemporaryDirectory() as directory, patch("web_backend.app.tempfile.tempdir", directory):
            for format in ("csv", "postgresql"):
                response = self.http.get(f"/api/transfer/export/{format}")
                self.assertEqual(response.status_code, 403)
                self.assertNotIn("content-disposition", response.headers)
                self.assertIn("permission denied", response.json()["detail"])
                self.assertEqual(list(Path(directory).iterdir()), [])

    def test_authentication_required_and_unknown_formats_rejected(self):
        self.assertEqual(self.http.get("/api/transfer/export/zip").status_code, 422)
        self.assertEqual(self.db.calls, [])
        self.app.dependency_overrides.clear()
        for format in ("csv", "postgresql"):
            self.assertEqual(self.http.get(f"/api/transfer/export/{format}").status_code, 401)
        self.assertEqual(self.db.calls, [])


if __name__ == "__main__":
    unittest.main()
