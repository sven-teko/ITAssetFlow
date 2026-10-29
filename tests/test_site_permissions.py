"""Standortauswahl: Validierung, Fail-closed-Laden und atomare RPC-Aufrufe."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from test_update import FakeClient
from infrastructure.asset_repository import AssetRepository
from web_backend.settings_routes import SettingsService


class SitePermissionTests(unittest.TestCase):
    def test_load_keeps_empty_selection_and_admin_full_access(self):
        client = FakeClient({'sites': [{'id': 1, 'name': 'Basel'}, {'id': 2, 'name': 'Allschwil'}],
            'employees': [{'id': 1, 'app_role': 'admin'}, {'id': 2, 'app_role': 'user'}, {'id': 3, 'app_role': 'viewer'}],
            'employee_site_access': [{'employee_id': 2, 'site_id': 1}]})
        rows = SettingsService(client).load()['employees']
        self.assertEqual([row['allowed_site_ids'] for row in rows], [[1, 2], [1], []])

    def test_invalid_or_duplicate_site_rejected_before_any_write(self):
        for refs in (None, ['id:999'], [True], ['id:1', 'id:1']):
            with self.subTest(refs=refs):
                client = FakeClient({'sites': [{'id': 1, 'name': 'Basel'}]})
                with self.assertRaises(ValueError):
                    SettingsService(client).save({'employees': [{'first_name': 'Test', 'last_name': 'User', 'allowed_site_refs': refs}]})
                self.assertEqual(client.writes, [])

    def test_permission_replacement_uses_rpc_and_resolves_new_site(self):
        client = FakeClient({'employees': [{'id': 2, 'auth_user_id': 'linked'}, {'id': 3, 'auth_user_id': None}]})
        client.rpc = Mock(return_value=SimpleNamespace(execute=lambda: SimpleNamespace(data=True)))
        service = SettingsService(client)
        service._save_site_permissions([
            {'id': 2, 'allowed_site_refs': ['new-site', 'id:5']},
            {'id': 3, 'allowed_site_refs': []},
        ], {'new-site': 42})
        client.rpc.assert_called_once_with('set_employee_site_access', {'p_employee_id': 2, 'p_site_ids': [42, 5]})

    def test_empty_selection_is_saved_and_old_clients_preserve_rights(self):
        client = FakeClient({'employees': [{'id': 2, 'auth_user_id': 'linked'}]})
        client.rpc = Mock(return_value=SimpleNamespace(execute=lambda: SimpleNamespace(data=True)))
        service = SettingsService(client)
        service._save_site_permissions([{'id': 2}], {})
        client.rpc.assert_not_called()
        service._save_site_permissions([{'id': 2, 'allowed_site_refs': []}], {})
        client.rpc.assert_called_once_with('set_employee_site_access', {'p_employee_id': 2, 'p_site_ids': []})

    def test_permission_save_requires_rpc_confirmation(self):
        client = FakeClient({'employees': [{'id': 2, 'auth_user_id': 'linked'}]})
        client.rpc = Mock(return_value=SimpleNamespace(execute=lambda: SimpleNamespace(data=False)))
        with self.assertRaisesRegex(RuntimeError, 'nicht bestätigt'):
            SettingsService(client)._save_site_permissions([{'id': 2, 'allowed_site_refs': []}], {})

    def test_scoped_delete_is_atomic_and_requires_confirmation(self):
        client = FakeClient()
        client.rpc = Mock(return_value=SimpleNamespace(execute=lambda: SimpleNamespace(data=True)))
        AssetRepository(client)._delete_asset(123)
        client.rpc.assert_called_once_with('delete_scoped_asset', {'p_asset_id': 123})
        self.assertEqual(client.writes, [])
        client.rpc.return_value = SimpleNamespace(execute=lambda: SimpleNamespace(data=False))
        with self.assertRaises(ValueError):
            AssetRepository(client)._delete_asset(123)

    def test_settings_routes_reject_non_admin_before_database_access(self):
        from fastapi.testclient import TestClient
        from web_backend.app import app, get_web_session, WebSession
        client = FakeClient()
        try:
            with TestClient(app) as http:
                for role in ('user', 'viewer'):
                    app.dependency_overrides[get_web_session] = lambda role=role: WebSession(client, 'test@example.test', role)
                    self.assertEqual(http.get('/api/settings').status_code, 403)
                    self.assertEqual(http.put('/api/settings', json={'employees': []}).status_code, 403)
            self.assertEqual(client.writes, [])
        finally:
            app.dependency_overrides.clear()


if __name__ == '__main__':
    unittest.main()
