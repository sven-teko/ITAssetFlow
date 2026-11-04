from concurrent.futures import ThreadPoolExecutor
from unittest import TestCase
from unittest.mock import Mock, patch

from fastapi import FastAPI

from http_test_client import TestClient
from web_backend.app import app
from web_backend.rate_limits import RateLimitMiddleware, RateLimits, RequestWindow


class RateLimitTests(TestCase):
    def test_burst_is_rejected_before_api_and_recovers_after_window(self):
        now = [100.0]
        local = FastAPI()
        local.add_middleware(RateLimitMiddleware, limits=RateLimits(clock=lambda: now[0]))
        handler = Mock()

        @local.get("/api/test")
        def test_endpoint():
            handler()
            return {"ok": True}

        with TestClient(local) as client:
            responses = [
                client.get("/api/test", headers={"X-Forwarded-For": f"203.0.113.{i}"})
                for i in range(1, 101)
            ]
            self.assertEqual([r.status_code for r in responses], [200] * 30 + [429] * 70)
            self.assertEqual(handler.call_count, 30)
            self.assertEqual(responses[-1].headers["Retry-After"], "10")
            self.assertEqual(responses[-1].headers["Cache-Control"], "no-store")
            now[0] += 10
            self.assertEqual(client.get("/api/test").status_code, 200)

    def test_render_keys_follow_proxy_client_ip_not_shared_backend_socket(self):
        local = FastAPI()
        local.add_middleware(RateLimitMiddleware, limits=RateLimits(), render=True)

        @local.get("/api/test")
        def test_endpoint():
            return {"ok": True}

        with TestClient(local) as client:
            for i in range(1, 31):
                self.assertEqual(client.get("/api/test", headers={
                    "X-Forwarded-For": f"2001:db8:1:2::{i}, 203.0.113.{i}",
                }).status_code, 200)
            self.assertEqual(client.get("/api/test", headers={
                "X-Forwarded-For": "2001:db8:1:2::31, 203.0.113.31",
            }).status_code, 429)
            self.assertEqual(client.get("/api/test", headers={
                "X-Forwarded-For": "2001:db8:1:3::1, 203.0.113.31",
            }).status_code, 200)

    def test_login_ip_and_account_limits_precede_provider_calls(self):
        with patch("web_backend.app.get_app_config"), patch(
            "web_backend.app.authenticate_user", side_effect=ValueError("Falsche Anmeldedaten")
        ) as provider, TestClient(app) as client:
            def login(client, email):
                return client.post("/api/auth/login", json={"email": email, "password": "example"},
                                   headers={"Origin": "http://localhost:5173"})

            for i in range(5):
                self.assertEqual(login(client, f"rotation-{i}@example.test").status_code, 401)
            denied = login(client, "rotation-5@example.test")
            self.assertEqual(denied.status_code, 429)
            self.assertEqual(denied.headers["Access-Control-Allow-Origin"], "http://localhost:5173")
            self.assertIn("Retry-After", denied.headers["Access-Control-Expose-Headers"])
            self.assertEqual(provider.call_count, 5)

            for i in range(11):
                with TestClient(app) as other:
                    response = login(other, "ATTACK@example.test" if i % 2 else "attack@example.test")
                    self.assertEqual(response.status_code, 401 if i < 10 else 429)
            self.assertEqual(provider.call_count, 15)

    def test_recovery_mail_limit_covers_same_address_across_ips(self):
        with patch("web_backend.recovery_routes.recovery_client") as provider:
            for i in range(4):
                with TestClient(app, base_url="https://itassetflow-demo.onrender.com") as client:
                    response = client.post("/api/auth/recovery/request",
                                           json={"email": "recovery-rate@example.test"},
                                           headers={"Origin": "https://itassetflow-demo.onrender.com"})
                    self.assertEqual(response.status_code, 200 if i < 3 else 429)
            self.assertEqual(provider.return_value.auth.reset_password_for_email.call_count, 3)

    def test_parallel_requests_cannot_exceed_budget_or_evict_active_keys(self):
        now = [100.0]
        window = RequestWindow(5, 60, clock=lambda: now[0], max_keys=1)
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(window.consume, ["ip"] * 60))
        self.assertEqual(results.count(0), 5)
        self.assertGreater(window.consume("new"), 0)
        self.assertEqual(window.consume("ip"), 60)
        now[0] += 60
        self.assertEqual(window.consume("new"), 0)
