"""Persönliche Darstellungsdaten dürfen nur das eigene Auth-Profil ändern."""
from types import SimpleNamespace
import unittest

import test_update
from web_backend.preferences_routes import PREFERENCE_KEY


class ColumnPreferenceTests(unittest.TestCase):
    def setUp(self):
        test_update.ApiTests.setUp(self)
        self.session.email = "viewer@example.test"
        self.session.role = "viewer"
        self.preferences = {"column_order": ["site_name", "asset_tag"], "visible_columns": ["site_name"]}
        self.user = SimpleNamespace(id="current-user", user_metadata={"display_name": "Test", PREFERENCE_KEY: self.preferences})
        self.db.auth.get_user.return_value = SimpleNamespace(user=self.user)
        self.db.auth.update_user.return_value = SimpleNamespace(user=self.user)
        self.headers = {"X-ITAssetFlow-User": "viewer@example.test"}

    def tearDown(self):
        test_update.ApiTests.tearDown(self)

    def test_read_returns_only_layout_without_other_profile_fields(self):
        response = self.client.get("/api/preferences/inventory-columns", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"preferences": self.preferences})
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_each_role_can_save_only_own_layout(self):
        for role in ("viewer", "user", "admin"):
            self.session.role = role
            response = self.client.put("/api/preferences/inventory-columns", json=self.preferences, headers=self.headers)
            self.assertEqual(response.status_code, 200)
        self.db.auth.update_user.assert_called_with({"data": {PREFERENCE_KEY: self.preferences}})
        self.db.table.assert_not_called()

    def test_account_switch_cannot_write_to_new_account(self):
        response = self.client.put("/api/preferences/inventory-columns", json=self.preferences,
                                   headers={"X-ITAssetFlow-User": "other@example.test"})
        self.assertEqual(response.status_code, 409)
        self.db.auth.update_user.assert_not_called()

    def test_invalid_and_foreign_fields_are_rejected(self):
        for payload in ({**self.preferences, "user_id": "other"},
                        {**self.preferences, "visible_columns": []},
                        {**self.preferences, "visible_columns": ["unknown"]},
                        {**self.preferences, "column_order": ["bad-key!"]}):
            response = self.client.put("/api/preferences/inventory-columns", json=payload, headers=self.headers)
            self.assertEqual(response.status_code, 422)
        self.db.auth.update_user.assert_not_called()

    def test_missing_or_malformed_saved_layout_uses_default(self):
        for value in (None, {"column_order": "invalid"}):
            self.user.user_metadata[PREFERENCE_KEY] = value
            self.assertIsNone(self.client.get("/api/preferences/inventory-columns", headers=self.headers).json()["preferences"])

    def test_service_failure_is_visible(self):
        self.db.auth.update_user.side_effect = RuntimeError("offline")
        response = self.client.put("/api/preferences/inventory-columns", json=self.preferences, headers=self.headers)
        self.assertEqual(response.status_code, 503)

    def test_no_session_no_profile_access(self):
        self.app.dependency_overrides.clear()
        self.assertEqual(self.client.get("/api/preferences/inventory-columns").status_code, 401)
        self.db.auth.get_user.assert_not_called()


if __name__ == "__main__":
    unittest.main()
