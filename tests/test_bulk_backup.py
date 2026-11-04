import base64
import gzip
import json
import re
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import unittest

import test_update
from infrastructure.data_transfer_service import TABLE_ORDER
from web_backend.automatic_backup import AutomaticBackup, FREQUENCY_VARIABLE


class BackupAndBulkTests(unittest.TestCase):
    def setUp(self):
        test_update.ApiTests.setUp(self)
        self.snapshot = {
            "format": "ITAssetFlow-Backup", "version": 1, "created_at": "2026-11-03T01:00:00Z",
            "tables": {key: [] for key in (*TABLE_ORDER, "audit_log", "inventory_stock_requests")},
        }

    def tearDown(self):
        test_update.ApiTests.tearDown(self)

    def test_admin_backup_and_recovery_preparation(self):
        self.session.role = "user"
        self.assertEqual(self.client.get("/api/backup/download").status_code, 403)
        self.assertEqual(self.client.post("/api/backup/recovery-sql", content=b"test").status_code, 403)
        self.db.rpc.assert_not_called()
        self.session.role = "admin"
        self.snapshot["tables"]["assets"] = [{"id": 1, "note": "'); DROP TABLE assets; --"}]
        self.db.rpc.return_value.execute.return_value = SimpleNamespace(data=self.snapshot)
        backup = self.client.get("/api/backup/download")
        self.assertEqual(backup.status_code, 200)
        self.assertEqual(backup.headers["cache-control"], "no-store")
        self.assertEqual(json.loads(gzip.decompress(backup.content)), self.snapshot)
        self.db.rpc.assert_called_once_with("create_inventory_backup", {})
        recovery = self.client.post("/api/backup/recovery-sql", content=backup.content)
        self.assertEqual(recovery.status_code, 200)
        encoded = re.search(r"decode\('([A-Za-z0-9+/=]+)'", recovery.text).group(1)
        self.assertEqual(json.loads(base64.b64decode(encoded)), self.snapshot)
        self.assertNotIn("DROP TABLE", recovery.text)
        self.assertIn("::jsonb,false)", recovery.text)
        self.assertEqual(self.db.rpc.call_count, 1)
        self.assertEqual(self.client.post("/api/backup/recovery-sql", content=b"not a backup").status_code, 400)

    def test_automatic_schedule_rotation_visibility_and_download(self):
        settings = {}
        files = [
            {"id": i, "name": f"ITAssetFlow_2026-11-0{i}_010000Z_{i}-1.json.gz.p7m",
             "created_at": f"2026-11-0{i}T01:00:00Z", "size": 4, "state": "uploaded"}
            for i in range(1, 8)
        ] + [{"id": 8, "name": "unrelated.p7m", "created_at": "2026-11-08T01:00:00Z",
              "size": 4, "state": "uploaded"}]

        def github(request):
            path = request.url.path
            self.assertEqual(request.url.host, "api.github.com")
            if path == "/repos/example/backup":
                return httpx.Response(200, json={"private": True})
            if path.endswith(f"/actions/variables/{FREQUENCY_VARIABLE}"):
                if not settings:
                    return httpx.Response(404)
                if request.method == "PATCH":
                    settings.update(json.loads(request.content))
                    return httpx.Response(204)
                return httpx.Response(200, json=settings)
            if path.endswith("/actions/variables") and request.method == "POST":
                settings.update(json.loads(request.content))
                return httpx.Response(201)
            if path.endswith("/releases/tags/itassetflow-backups"):
                return httpx.Response(200, json={"assets": files})
            if path.endswith("/releases/assets/7"):
                self.assertEqual(request.headers["accept"], "application/octet-stream")
                return httpx.Response(200, content=b"mock")
            self.fail(f"Unexpected GitHub request: {request.method} {path}")

        def create_client():
            return httpx.Client(base_url="https://api.github.com", transport=httpx.MockTransport(github))

        with patch.dict("os.environ", {"ITASSETFLOW_BACKUP_GITHUB_REPOSITORY": "example/backup",
                                        "ITASSETFLOW_BACKUP_GITHUB_TOKEN": "test"}), \
                patch.object(AutomaticBackup, "_client", side_effect=create_client):
            self.session.role = "user"
            self.assertEqual(self.client.get("/api/backup/automatic").status_code, 403)
            self.assertEqual(self.client.put("/api/backup/automatic", json={"frequency": "monthly"}).status_code, 403)
            self.assertEqual(self.client.get("/api/backup/automatic/7").status_code, 403)
            self.session.role = "admin"
            response = self.client.get("/api/backup/automatic")
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.json()["frequency"], "weekly")
            self.assertEqual([item["id"] for item in response.json()["backups"]], [7, 6, 5, 4, 3])
            self.assertEqual(self.client.put("/api/backup/automatic", json={"frequency": "monthly"}).status_code, 200)
            self.assertEqual(self.client.put("/api/backup/automatic", json={"frequency": "daily"}).status_code, 200)
            self.assertEqual(self.client.put("/api/backup/automatic", json={"frequency": "hourly"}).status_code, 422)
            self.assertEqual(self.client.get("/api/backup/automatic").json()["frequency"], "daily")
            self.assertEqual(self.client.get("/api/backup/automatic/2").status_code, 404)
            self.assertEqual(self.client.get("/api/backup/automatic/8").status_code, 404)
            download = self.client.get("/api/backup/automatic/7")
            self.assertEqual(download.content, b"mock")
            self.assertIn(files[6]["name"], download.headers["content-disposition"])

    def test_bulk_edit_roles_and_request_shape(self):
        data = {"entries": [{"type": "asset", "id": 1}, {"type": "asset", "id": 2}],
                "changes": {"condition": "used"}}
        self.session.role = "viewer"
        self.assertEqual(self.client.patch("/api/inventory/bulk", json=data).status_code, 403)
        self.db.rpc.assert_not_called()
        self.session.role = "user"
        self.db.rpc.return_value.execute.return_value = SimpleNamespace(data=2)
        response = self.client.patch("/api/inventory/bulk", json=data)
        self.assertEqual(response.json(), {"updated_count": 2})
        self.db.rpc.assert_called_once_with("bulk_edit_inventory", {"p_entries": data["entries"], "p_changes": data["changes"]})
        self.assertEqual(self.client.patch("/api/inventory/bulk", json={**data, "entries": data["entries"][:1]}).status_code, 422)
