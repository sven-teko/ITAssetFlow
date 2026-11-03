"""Generate an ITAssetFlow recovery script without needing a running web app."""
from __future__ import annotations

import argparse
import base64
import gzip
import json
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--keep-auth-links", action="store_true")
    args = parser.parse_args()
    with gzip.open(args.backup, "rb") as stream:
        content = stream.read(100 * 1024 * 1024 + 1)
    if len(content) > 100 * 1024 * 1024:
        parser.error("Die entpackte Sicherung überschreitet 100 MB.")
    backup = json.loads(content)
    if not isinstance(backup, dict) or backup.get("format") != "ITAssetFlow-Backup" or backup.get("version") != 1:
        parser.error("Kein unterstütztes ITAssetFlow-Backup.")
    encoded = base64.b64encode(content).decode("ascii")
    out = args.backup.with_suffix("").with_suffix(".restore.sql")
    with os.fdopen(os.open(out, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w", encoding="utf-8") as stream:
        stream.write("BEGIN;\n")
        stream.write(f"SELECT private.restore_inventory_backup(convert_from(decode('{encoded}','base64'),'UTF8')::jsonb,"
                     f"{str(args.keep_auth_links).lower()}) AS wiederhergestellte_zeilen;\nCOMMIT;\n")
    print(out)


if __name__ == "__main__":
    main()
