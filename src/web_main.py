from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn


# =========================================================
# Pfade
# =========================================================

SRC_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SRC_DIR.parent
WEB_DIR = PROJECT_ROOT / "web"


# =========================================================
# Backend
# =========================================================

BACKEND_HOST = "0.0.0.0"
BACKEND_PORT = 8000


# =========================================================
# React / Vite
# =========================================================

FRONTEND_HOST = "localhost"
FRONTEND_PORT = 5173

FRONTEND_URL = (
    f"http://{FRONTEND_HOST}:{FRONTEND_PORT}"
)


# Browser beim Start automatisch öffnen.
OPEN_BROWSER = True


# =========================================================
# NPM finden
# =========================================================

def find_npm() -> str:
    """
    Sucht die installierte npm-Executable.

    Unter Windows wird bevorzugt npm.cmd verwendet,
    damit keine PowerShell-ExecutionPolicy-Probleme
    mit npm.ps1 auftreten.
    """

    candidates: list[str]

    if os.name == "nt":
        candidates = [
            "npm.cmd",
            "npm.exe",
            "npm",
        ]
    else:
        candidates = [
            "npm",
        ]

    for candidate in candidates:
        executable = shutil.which(
            candidate
        )

        if executable:
            return executable

    raise RuntimeError(
        "npm wurde nicht gefunden.\n\n"
        "Bitte prüfe, ob Node.js installiert ist "
        "und npm über die PATH-Umgebungsvariable "
        "erreichbar ist."
    )


# =========================================================
# Frontend starten
# =========================================================

def start_frontend() -> subprocess.Popen:
    """
    Startet den Vite-Entwicklungsserver.
    """

    if not WEB_DIR.is_dir():
        raise RuntimeError(
            f"Der Web-Ordner wurde nicht gefunden:\n"
            f"{WEB_DIR}"
        )

    package_json = (
        WEB_DIR
        / "package.json"
    )

    if not package_json.is_file():
        raise RuntimeError(
            f"package.json wurde nicht gefunden:\n"
            f"{package_json}"
        )

    npm = find_npm()

    print()
    print(
        "=========================================="
    )
    print(
        " ITAssetFlow React-Frontend"
    )
    print(
        "=========================================="
    )
    print(
        f"Web-Verzeichnis: {WEB_DIR}"
    )
    print(
        f"Frontend:        {FRONTEND_URL}"
    )
    print()


    process = subprocess.Popen(
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

    return process


# =========================================================
# Browser öffnen
# =========================================================

def open_browser_delayed() -> None:
    """
    Öffnet die React-Anwendung etwas verzögert,
    damit Vite vorher starten kann.
    """

    time.sleep(
        1.5
    )

    try:
        webbrowser.open(
            FRONTEND_URL
        )

    except Exception:
        # Ein Fehler beim Browserstart darf
        # die Anwendung nicht beenden.
        pass


# =========================================================
# Frontend beenden
# =========================================================

def stop_frontend(
    process: subprocess.Popen | None,
) -> None:
    """
    Beendet den gestarteten Vite-Prozess.
    """

    if process is None:
        return

    if (
        process.poll()
        is not None
    ):
        return


    print()
    print(
        "React-Frontend wird beendet ..."
    )


    try:
        if os.name == "nt":
            # Unter Windows beendet taskkill auch
            # von npm gestartete Kindprozesse wie Vite.
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
# Hauptprogramm
# =========================================================

def main() -> None:
    frontend_process: subprocess.Popen | None = (
        None
    )

    try:
        # -------------------------------------------------
        # React / Vite starten
        # -------------------------------------------------

        frontend_process = (
            start_frontend()
        )


        # -------------------------------------------------
        # Browser öffnen
        # -------------------------------------------------

        if OPEN_BROWSER:
            browser_thread = threading.Thread(
                target=open_browser_delayed,
                daemon=True,
            )

            browser_thread.start()


        # -------------------------------------------------
        # Backend starten
        # -------------------------------------------------

        print()
        print(
            "=========================================="
        )
        print(
            " ITAssetFlow FastAPI-Backend"
        )
        print(
            "=========================================="
        )
        print(
            f"Backend:         "
            f"http://localhost:{BACKEND_PORT}"
        )
        print(
            f"API-Dokumentation: "
            f"http://localhost:{BACKEND_PORT}/docs"
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
        )


    except KeyboardInterrupt:
        pass

    except Exception as error:
        print()
        print(
            "ITAssetFlow Web konnte nicht "
            "gestartet werden:"
        )
        print(
            error
        )
        print()

        raise

    finally:
        stop_frontend(
            frontend_process
        )


if __name__ == "__main__":
    main()