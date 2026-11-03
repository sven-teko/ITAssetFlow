import base64
import gzip
import json
import re
from types import SimpleNamespace
import unittest

import test_update
from infrastructure.data_transfer_service import TABLE_ORDER


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
