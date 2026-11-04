"""Give independent API tests separate simulated clients."""
from itertools import count
from ipaddress import IPv4Address

from fastapi.testclient import TestClient as FastAPITestClient

addresses = count(int(IPv4Address("198.18.0.1")))


class TestClient(FastAPITestClient):
    __test__ = False

    def __init__(self, app, **kwargs):
        kwargs.setdefault("client", (str(IPv4Address(next(addresses))), 12345))
        super().__init__(app, **kwargs)
