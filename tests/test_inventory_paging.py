from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from web_backend.app import REFRESH_COOKIE, app, get_web_session
from web_backend.inventory_paging import InventoryQuery, InventorySnapshots, filtered


class InventoryPagingTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.revision = 10
        self.rows = [{"id": n, "_record_type": "asset", "asset_tag": f"PC-{n}",
                      "new_price": 99 if n == 1205 else 0, "status": "available",
                      "site_name": "Basel" if n < 1205 else "Allschwil"}
                     for n in range(1, 1206)]
        self.db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = (
            lambda: SimpleNamespace(data=[{"revision": self.revision}])
        )
        self.session = SimpleNamespace(client=self.db, email="editor@example.test", role="user")
        app.dependency_overrides[get_web_session] = lambda: self.session
        self.http = TestClient(app)
        self.http.cookies.set(REFRESH_COOKIE, "first-session")
        self.cache = patch("web_backend.app._inventory_snapshots", InventorySnapshots())
        self.cache.start()
        self.fetch = patch("web_backend.app._load_inventory_rows", side_effect=lambda _client: self.rows)
        self.fetcher = self.fetch.start()

    def tearDown(self):
        self.fetch.stop()
        self.cache.stop()
        app.dependency_overrides.pop(get_web_session, None)
        self.http.close()

    def page(self, **data):
        return self.http.post("/api/inventory/page", json=data)

    def test_fetches_only_one_page_and_global_filters_and_sort(self):
        query = {"column": "asset_tag", "sort": "desc"}
        first = self.page(query=query)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers["cache-control"], "no-store")
        first = first.json()
        self.assertEqual(len(first["rows"]), 100)
        self.assertEqual(first["total"], 1205)
        self.assertEqual(first["rows"][0]["asset_tag"], "PC-1205")
        self.assertEqual(first["next_offset"], 100)
        self.assertIn({"key": "allschwil", "label": "Allschwil"}, first["options"]["sites"])
        second = self.page(query=query, offset=100, snapshot=first["snapshot"]).json()
        self.assertEqual(second["rows"][0]["asset_tag"], "PC-1105")
        self.assertIsNone(second["options"])
        self.assertEqual(self.fetcher.call_count, 1)
        found = self.page(query={"filters": {"sites": ["allschwil"]}, "price_from": 98, "search": "1205"}).json()
        self.assertEqual(found["matched"], 1)
        self.assertEqual(found["rows"][0]["id"], 1205)
        self.assertIsNone(found["next_offset"])

    def test_snapshot_cannot_cross_sessions_queries_or_permission_changes(self):
        first = self.page().json()
        self.assertEqual(self.page(offset=100, snapshot=first["snapshot"], query={"search": "PC-4"}).status_code, 409)
        self.http.cookies.set(REFRESH_COOKIE, "second-session")
        self.assertEqual(self.page(offset=100, snapshot=first["snapshot"]).status_code, 409)
        self.http.cookies.set(REFRESH_COOKIE, "first-session")
        self.revision += 1
        self.rows = self.rows[:-1]
        self.assertEqual(self.page(offset=100, snapshot=first["snapshot"]).status_code, 409)
        self.assertEqual(self.page().json()["total"], 1204)
        self.assertEqual(self.page(limit=1000).status_code, 422)

    def test_mac_and_localized_condition_can_be_searched(self):
        rows = [{"mac_address": "AA:BB:CC:DD:EE:FF", "condition": "used"}]
        self.assertEqual(filtered(rows, InventoryQuery(search="aabbccddeeff")), rows)
        self.assertEqual(filtered(rows, InventoryQuery(search="Gebraucht")), rows)
