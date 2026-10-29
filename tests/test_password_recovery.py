"""Recovery-API ohne echte Konten, E-Mails oder Passwortänderungen testen."""
import os
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from httpx import ConnectError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from web_backend import recovery_routes as recovery


class ProviderError(Exception):
    def __init__(self, code):
        self.code = code


class PasswordRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"ITASSETFLOW_PUBLIC_URL": "https://itassetflow-demo.onrender.com"})
        self.env.start()
        self.provider = Mock()
        self.user = SimpleNamespace(id="account-from-verified-token", email="test@example.test")
        self.session = SimpleNamespace(access_token="test-access-token", expires_at=int(time.time()) + 3600)
        self.provider.auth.set_session.return_value = SimpleNamespace(user=self.user, session=self.session)
        self.provider.auth.update_user.return_value = SimpleNamespace(user=self.user)
        self.factory = patch.object(recovery, "recovery_client", return_value=self.provider)
        self.factory_mock = self.factory.start()
        self.clear_login = Mock()
        app = FastAPI()
        app.include_router(recovery.create_recovery_router(self.clear_login, ["http://localhost:5173"]))
        self.http = TestClient(app, base_url="https://itassetflow-demo.onrender.com", headers={"Origin": "https://itassetflow-demo.onrender.com"})
        self.base = "/api/auth/recovery"

    def tearDown(self):
        self.http.close()
        self.factory.stop()
        self.env.stop()

    def open(self):
        response = self.http.post(self.base + "/session", json={"access_token": "test-access-token"})
        self.assertEqual(response.status_code, 200)
        return response

    def test_link_request_has_fixed_render_redirect_and_no_account_disclosure(self):
        response = self.http.post(self.base + "/request", json={"email": " test@example.test "})
        self.assertEqual(response.json(), {"requested": True})
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.provider.auth.reset_password_for_email.assert_called_once_with("test@example.test", {"redirect_to": "https://itassetflow-demo.onrender.com/"})

    def test_request_rejects_invalid_email_and_extra_redirect(self):
        for payload in ({"email": "bad@"}, {"email": "test@example.test", "redirect_to": "https://other.example"}):
            response = self.http.post(self.base + "/request", json=payload)
            self.assertIn(response.status_code, (400, 422))
        self.factory_mock.assert_not_called()

    def test_request_rate_limit_and_provider_failure(self):
        for code, status in (("over_email_send_rate_limit", 429), ("internal_error", 503)):
            self.provider.auth.reset_password_for_email.side_effect = ProviderError(code)
            self.assertEqual(self.http.post(self.base + "/request", json={"email": "test@example.test"}).status_code, status)

    def test_cross_origin_writes_are_rejected_before_provider_access(self):
        for method, endpoint, payload in (("post", "/request", {"email": "test@example.test"}), ("post", "/session", {"access_token": "token"}), ("post", "/password", {"password": "test-password"}), ("delete", "/session", None)):
            kwargs = {"headers": {"Origin": "https://other.example"}}
            if payload is not None:
                kwargs["json"] = payload
            self.assertEqual(getattr(self.http, method)(self.base + endpoint, **kwargs).status_code, 403)
        self.factory_mock.assert_not_called()

    def test_bootstrap_validates_token_and_uses_separate_scoped_cookie(self):
        response = self.open()
        self.provider.auth.set_session.assert_called_once_with("test-access-token", "")
        cookie = response.headers["set-cookie"]
        for part in ("HttpOnly", "Secure", "SameSite=strict", "Path=/api/auth/recovery"):
            self.assertIn(part, cookie)
        self.assertNotIn("refresh", cookie)
        self.assertEqual(response.json(), {"ready": True, "email": "test@example.test"})
        ordinary = self.http.build_request("GET", "/api/inventory")
        self.assertNotIn(recovery.RECOVERY_COOKIE, ordinary.headers.get("cookie", ""))
        self.clear_login.assert_not_called()

    def test_invalid_token_clears_previous_cookie(self):
        self.open()
        self.provider.auth.set_session.side_effect = ValueError("invalid")
        response = self.http.post(self.base + "/session", json={"access_token": "invalid"})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn(recovery.RECOVERY_COOKIE, self.http.cookies)
        self.provider.auth.update_user.assert_not_called()

    def test_expired_and_incomplete_session_are_rejected(self):
        for auth in (SimpleNamespace(user=None, session=self.session), SimpleNamespace(user=self.user, session=None), SimpleNamespace(user=self.user, session=SimpleNamespace(expires_at=time.time()-1))):
            self.provider.auth.set_session.return_value = auth
            self.assertEqual(self.http.post(self.base + "/session", json={"access_token": "token"}).status_code, 401)

    def test_status_without_cookie_does_not_contact_provider(self):
        self.assertEqual(self.http.get(self.base + "/session").json(), {"ready": False})
        self.factory_mock.assert_not_called()

    def test_reload_rechecks_verified_user(self):
        self.open()
        self.assertEqual(self.http.get(self.base + "/session").json(), {"ready": True, "email": "test@example.test"})
        self.assertEqual(self.provider.auth.set_session.call_count, 2)

    def test_provider_outage_does_not_expire_existing_recovery(self):
        self.open()
        self.provider.auth.set_session.side_effect = ConnectError("test network failure")
        self.assertEqual(self.http.get(self.base + "/session").status_code, 503)
        self.assertEqual(self.http.post(self.base + "/session", json={"access_token": "test-access-token"}).status_code, 503)
        self.assertIn(recovery.RECOVERY_COOKIE, self.http.cookies)
        self.provider.auth.set_session.side_effect = None
        self.assertTrue(self.http.get(self.base + "/session").json()["ready"])

    def test_password_change_needs_verified_recovery_cookie(self):
        response = self.http.post(self.base + "/password", json={"password": "test-password"})
        self.assertEqual(response.status_code, 401)
        self.provider.auth.update_user.assert_not_called()

    def test_password_changes_only_token_owner_and_clears_session(self):
        self.open()
        response = self.http.post(self.base + "/password", json={"password": "new-test-password"})
        self.assertEqual(response.json(), {"updated": True})
        self.provider.auth.update_user.assert_called_once_with({"password": "new-test-password"})
        self.provider.auth.sign_out.assert_called_once_with({"scope": "local"})
        self.assertNotIn(recovery.RECOVERY_COOKIE, self.http.cookies)
        self.clear_login.assert_called_once()
        self.assertNotIn("new-test-password", response.text)

    def test_password_and_target_validation(self):
        self.open()
        for payload in ({"password": "short"}, {"password": "x"*129}, {"password": "new-test-password", "user_id": "other-account"}):
            self.assertIn(self.http.post(self.base + "/password", json=payload).status_code, (400, 422))
        self.provider.auth.update_user.assert_not_called()

    def test_password_failure_can_be_retried(self):
        self.open()
        for code, status in (("weak_password", 400), ("same_password", 400), ("network_error", 503)):
            self.provider.auth.update_user.side_effect = ProviderError(code)
            self.assertEqual(self.http.post(self.base + "/password", json={"password": "new-test-password"}).status_code, status)
            self.assertIn(recovery.RECOVERY_COOKIE, self.http.cookies)
        self.provider.auth.update_user.side_effect = None
        self.assertTrue(self.http.post(self.base + "/password", json={"password": "new-test-password"}).json()["updated"])

    def test_expired_update_clears_cookie(self):
        self.open()
        self.provider.auth.update_user.side_effect = ProviderError("session_expired")
        self.assertEqual(self.http.post(self.base + "/password", json={"password": "new-test-password"}).status_code, 401)
        self.assertNotIn(recovery.RECOVERY_COOKIE, self.http.cookies)

    def test_mismatched_confirmation_is_not_reported_as_success(self):
        self.open()
        self.provider.auth.update_user.return_value = SimpleNamespace(user=SimpleNamespace(id="other-account"))
        self.assertEqual(self.http.post(self.base + "/password", json={"password": "new-test-password"}).status_code, 502)

    def test_cancel_discards_only_recovery_cookie(self):
        self.open()
        self.assertTrue(self.http.delete(self.base + "/session").json()["cleared"])
        self.assertNotIn(recovery.RECOVERY_COOKIE, self.http.cookies)
        self.clear_login.assert_not_called()

    def test_signout_error_does_not_hide_confirmed_password_change(self):
        self.open()
        self.provider.auth.sign_out.side_effect = RuntimeError("network")
        self.assertEqual(self.http.post(self.base + "/password", json={"password": "new-test-password"}).json(), {"updated": True})

    def test_public_url_requires_https_without_secrets(self):
        for value in ("http://localhost:3000", "https://example.test/#token", "https://user:password@example.test"):
            with patch.dict(os.environ, {"ITASSETFLOW_PUBLIC_URL": value}), self.assertRaises(RuntimeError):
                recovery.public_app_url()


if __name__ == "__main__":
    unittest.main()
