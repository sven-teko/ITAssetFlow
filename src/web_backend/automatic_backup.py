"""GitHub storage and schedule for encrypted automatic inventory backups."""
from __future__ import annotations

import os
import re

import httpx
from fastapi import HTTPException

FREQUENCIES = ("daily", "weekly", "monthly")
FREQUENCY_VARIABLE = "ITASSETFLOW_BACKUP_FREQUENCY"
RELEASE_TAG = "itassetflow-backups"
RETAIN_COUNT = 5
MAX_ASSET_BYTES = 30 * 1024 * 1024
ASSET_NAME = re.compile(r"ITAssetFlow_\d{4}-\d{2}-\d{2}_\d{6}Z_\d+-\d+\.json\.gz\.p7m")
REPO_NAME = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9_.-]+")


class AutomaticBackup:
    def __init__(self):
        self.repo = os.environ.get("ITASSETFLOW_BACKUP_GITHUB_REPOSITORY", "").strip()
        self.token = os.environ.get("ITASSETFLOW_BACKUP_GITHUB_TOKEN", "").strip()
        self.configured = bool(REPO_NAME.fullmatch(self.repo) and self.token)

    def _client(self) -> httpx.Client:
        if not self.configured:
            raise HTTPException(503, "Die automatische Sicherung ist noch nicht mit GitHub verbunden.")
        return httpx.Client(
            base_url="https://api.github.com",
            headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28"},
            timeout=httpx.Timeout(20, connect=5),
            follow_redirects=True,
        )

    def _private_repository(self, client: httpx.Client) -> None:
        response = client.get(f"/repos/{self.repo}")
        response.raise_for_status()
        if response.json().get("private") is not True:
            raise HTTPException(503, "Für automatische Sicherungen ist ein privates GitHub-Repository erforderlich.")

    def _list(self, client: httpx.Client) -> list[dict]:
        release = client.get(f"/repos/{self.repo}/releases/tags/{RELEASE_TAG}")
        if release.status_code == 404:
            return []
        release.raise_for_status()
        files = []
        for asset in release.json()["assets"]:
            name = asset.get("name", "")
            if ASSET_NAME.fullmatch(name) and asset.get("state") == "uploaded":
                files.append({key: asset[key] for key in ("id", "name", "created_at", "size")})
        return sorted(files, key=lambda item: (item["created_at"], item["id"]), reverse=True)[:RETAIN_COUNT]

    def settings(self) -> dict:
        if not self.configured:
            return {"configured": False, "frequency": "weekly", "backups": []}
        with self._client() as client:
            self._private_repository(client)
            variable = client.get(f"/repos/{self.repo}/actions/variables/{FREQUENCY_VARIABLE}")
            if variable.status_code == 404:
                frequency = "weekly"
            else:
                variable.raise_for_status()
                frequency = variable.json()["value"]
                if frequency not in FREQUENCIES:
                    raise HTTPException(503, "Das in GitHub gespeicherte Sicherungsintervall ist ungültig.")
            return {"configured": True, "frequency": frequency, "backups": self._list(client)}

    def save_frequency(self, frequency: str) -> None:
        with self._client() as client:
            self._private_repository(client)
            path = f"/repos/{self.repo}/actions/variables"
            response = client.patch(f"{path}/{FREQUENCY_VARIABLE}", json={"value": frequency})
            if response.status_code == 404:
                response = client.post(path, json={"name": FREQUENCY_VARIABLE, "value": frequency})
                if response.status_code in (409, 422):
                    # A concurrent first save may have created the variable.
                    response = client.patch(f"{path}/{FREQUENCY_VARIABLE}", json={"value": frequency})
            response.raise_for_status()

    def download(self, asset_id: int) -> tuple[str, bytes]:
        with self._client() as client:
            self._private_repository(client)
            asset = next((item for item in self._list(client) if item["id"] == asset_id), None)
            if asset is None:
                raise HTTPException(404, "Diese Sicherung ist nicht mehr verfügbar.")
            if asset["size"] > MAX_ASSET_BYTES:
                raise HTTPException(413, "Die Sicherungsdatei ist zu gross.")
            with client.stream("GET", f"/repos/{self.repo}/releases/assets/{asset_id}",
                               headers={"Accept": "application/octet-stream"}) as response:
                response.raise_for_status()
                content = bytearray()
                for chunk in response.iter_bytes():
                    if len(content) + len(chunk) > MAX_ASSET_BYTES:
                        raise HTTPException(413, "Die Sicherungsdatei ist zu gross.")
                    content.extend(chunk)
                if len(content) != asset["size"]:
                    raise HTTPException(502, "Die Sicherungsdatei konnte nicht vollständig geladen werden.")
                return asset["name"], bytes(content)
