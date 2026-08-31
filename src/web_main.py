from __future__ import annotations

import argparse
import codecs
from importlib import metadata
import os
from pathlib import Path
import shutil
import subprocess
import sys


APP_NAME = "ITAssetFlow"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = PROJECT_ROOT / "web"
REQUIREMENTS_FILE = PROJECT_ROOT / "requirements.txt"

BACKEND_HOST = os.getenv(
    "ITASSETFLOW_WEB_HOST",
    "0.0.0.0",
).strip() or "0.0.0.0"

BACKEND_PORT = int(
    os.getenv(
        "ITASSETFLOW_WEB_PORT",
        "8000",
    )
)

FRONTEND_HOST = os.getenv(
    "ITASSETFLOW_VITE_HOST",
    "127.0.0.1",
).strip() or "127.0.0.1"

FRONTEND_PORT = int(
    os.getenv(
        "ITASSETFLOW_VITE_PORT",
        "5173",
    )
)

FORWARDED_ALLOW_IPS = os.getenv(
    "ITASSETFLOW_FORWARDED_ALLOW_IPS",
    "127.0.0.1",
).strip() or "127.0.0.1"


# =========================================================
# Python-Requirements
# =========================================================

def _read_text_auto(path: Path) -> str:
    """Liest UTF-8-, UTF-16- und UTF-32-Textdateien robust ein."""

    prefix = path.read_bytes()[:4]

    if prefix.startswith(codecs.BOM_UTF8):
        encoding = "utf-8-sig"
    elif (
        prefix.startswith(codecs.BOM_UTF32_LE)
        or prefix.startswith(codecs.BOM_UTF32_BE)
    ):
        encoding = "utf-32"
    elif (
        prefix.startswith(codecs.BOM_UTF16_LE)
        or prefix.startswith(codecs.BOM_UTF16_BE)
    ):
        encoding = "utf-16"
    else:
        encoding = "utf-8"

    return path.read_text(
        encoding=encoding
    )


def _distribution_name(
    requirement_line: str,
) -> str:
    """Ermittelt den installierten Distributionsnamen einer Requirement-Zeile."""

    line = requirement_line.strip()

    if not line:
        return ""

    line = line.split(
        ";",
        1,
    )[0].strip()

    if (
        not line
        or line.startswith("-")
        or "://" in line
        or line.startswith("git+")
    ):
        return ""

    for separator in (
        "===",
        "==",
        ">=",
        "<=",
        "~=",
        "!=",
        ">",
        "<",
    ):
        if separator in line:
            line = line.split(
                separator,
                1,
            )[0].strip()
            break

    if "[" in line:
        line = line.split(
            "[",
            1,
        )[0].strip()

    return line


def _required_packages() -> list[str]:
    """Liest die Paketnamen aus requirements.txt."""

    if not REQUIREMENTS_FILE.is_file():
        raise RuntimeError(
            "requirements.txt wurde nicht gefunden:\n"
            f"{REQUIREMENTS_FILE}"
        )

    packages: list[str] = []

    for raw_line in _read_text_auto(
        REQUIREMENTS_FILE
    ).splitlines():
        line = raw_line.strip()

        if (
            not line
            or line.startswith("#")
        ):
            continue

        line = line.split(
            "#",
            1,
        )[0].strip()

        package_name = _distribution_name(
            line
        )

        if package_name:
            packages.append(
                package_name
            )

    return packages


def _missing_packages() -> list[str]:
    """Prüft, welche Requirements noch nicht installiert sind."""

    missing: list[str] = []

    for package_name in _required_packages():
        try:
            metadata.version(
                package_name
            )
        except metadata.PackageNotFoundError:
            missing.append(
                package_name
            )

    return missing


def ensure_runtime_dependencies() -> None:
    """Installiert fehlende Python-Requirements vor dem Webserver-Start."""

    if getattr(
        sys,
        "frozen",
        False,
    ):
        return

    missing = _missing_packages()

    if not missing:
        return

    print()
    print(
        "Fehlende Python-Abhängigkeiten erkannt:"
    )

    for package_name in missing:
        print(
            f"  - {package_name}"
        )

    print()
    print(
        "requirements.txt wird installiert ..."
    )

    pip_check = subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "--version",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )

    if pip_check.returncode != 0:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "ensurepip",
                "--upgrade",
            ],
            check=True,
        )

    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(
                REQUIREMENTS_FILE
            ),
        ],
        check=True,
    )

    print(
        "Python-Abhängigkeiten wurden installiert."
    )
    print()


# Muss vor FastAPI/Uvicorn/Supabase usw. ausgeführt werden.
ensure_runtime_dependencies()


import uvicorn


# =========================================================
# Optionaler Vite-Entwicklungsserver
# =========================================================

def find_npm() -> str:
    """Findet npm. Unter Windows wird npm.cmd bevorzugt."""

    candidates = (
        [
            "npm.cmd",
            "npm.exe",
            "npm",
        ]
        if os.name == "nt"
        else [
            "npm",
        ]
    )

    for candidate in candidates:
        executable = shutil.which(
            candidate
        )

        if executable:
            return executable

    raise RuntimeError(
        "npm wurde nicht gefunden. "
        "Bitte Node.js installieren oder den "
        "Vite-Entwicklungsserver separat starten."
    )


def start_frontend_dev_server() -> subprocess.Popen:
    """Startet Vite nur bei explizitem --dev."""

    if not WEB_DIR.is_dir():
        raise RuntimeError(
            "Der Web-Ordner wurde nicht gefunden:\n"
            f"{WEB_DIR}"
        )

    package_json = WEB_DIR / "package.json"

    if not package_json.is_file():
        raise RuntimeError(
            "package.json wurde nicht gefunden:\n"
            f"{package_json}"
        )

    npm = find_npm()

    print()
    print(
        "React/Vite-Entwicklungsserver wird gestartet ..."
    )
    print(
        f"http://{FRONTEND_HOST}:{FRONTEND_PORT}"
    )
    print()

    return subprocess.Popen(
        [
            npm,
            "run",
            "dev",
            "--",
            "--host",
            FRONTEND_HOST,
            "--port",
            str(
                FRONTEND_PORT
            ),
        ],
        cwd=str(
            WEB_DIR
        ),
    )


def stop_frontend_dev_server(
    process: subprocess.Popen | None,
) -> None:
    """Beendet den von --dev gestarteten Vite-Prozess."""

    if (
        process is None
        or process.poll() is not None
    ):
        return

    print()
    print(
        "React/Vite-Entwicklungsserver wird beendet ..."
    )

    try:
        if os.name == "nt":
            subprocess.run(
                [
                    "taskkill",
                    "/PID",
                    str(
                        process.pid
                    ),
                    "/T",
                    "/F",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            process.terminate()

            try:
                process.wait(
                    timeout=5
                )
            except subprocess.TimeoutExpired:
                process.kill()

    except Exception:
        try:
            process.kill()
        except Exception:
            pass


# =========================================================
# Startparameter
# =========================================================

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Startet das ITAssetFlow FastAPI-Backend. "
            "Mit --dev wird zusätzlich Vite gestartet."
        )
    )

    parser.add_argument(
        "--dev",
        action="store_true",
        help=(
            "Zusätzlich den React/Vite-Entwicklungsserver starten. "
            "Es wird kein Browser automatisch geöffnet."
        ),
    )

    return parser.parse_args()


# =========================================================
# Hauptprogramm
# =========================================================

def main() -> None:
    args = parse_args()

    frontend_process: subprocess.Popen | None = None

    try:
        if args.dev:
            frontend_process = (
                start_frontend_dev_server()
            )

        print()
        print(
            "=========================================="
        )
        print(
            f" {APP_NAME} Web-Backend"
        )
        print(
            "=========================================="
        )
        print(
            f"FastAPI: http://{BACKEND_HOST}:{BACKEND_PORT}"
        )
        print(
            f"API-Dokumentation: "
            f"http://{BACKEND_HOST}:{BACKEND_PORT}/docs"
        )

        if not args.dev:
            print()
            print(
                "Produktivmodus: Kein Vite-Server und "
                "kein Browser werden gestartet."
            )
            print(
                "Das React-Frontend sollte von IIS aus web/dist "
                "bereitgestellt werden."
            )

        print()
        print(
            "Zum Beenden Strg+C drücken."
        )
        print()

        uvicorn.run(
            "web_backend.app:app",
            host=BACKEND_HOST,
            port=BACKEND_PORT,
            reload=False,
            proxy_headers=True,
            forwarded_allow_ips=FORWARDED_ALLOW_IPS,
        )

    except KeyboardInterrupt:
        pass

    except Exception as error:
        print()
        print(
            "ITAssetFlow Web konnte nicht gestartet werden:"
        )
        print(
            error
        )
        print()

        raise

    finally:
        stop_frontend_dev_server(
            frontend_process
        )


if __name__ == "__main__":
    main()
