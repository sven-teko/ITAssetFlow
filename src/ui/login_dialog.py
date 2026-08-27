from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import logging
import os
import sys
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Callable

from PySide6.QtCore import QObject, QRunnable, QSettings, QThreadPool, Qt, Signal, Slot
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)
from supabase import Client

from config import (
    load_supabase_connection_settings,
    save_supabase_connection_settings,
)
from infrastructure.supabase_client import (
    authenticate_user,
    get_session_tokens,
    restore_user_session,
    test_supabase_connection,
)


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SavedLogin:
    profile_id: str
    email: str


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _normalize_url(value: str) -> str:
    return str(value or "").strip().rstrip("/")


def _key_fingerprint(value: str) -> str:
    return hashlib.sha256(
        str(value or "").strip().encode("utf-8")
    ).hexdigest()


def _profile_id(
    supabase_url: str,
    supabase_key: str,
    email: str,
) -> str:
    payload = (
        _normalize_url(supabase_url)
        + "\n"
        + _key_fingerprint(supabase_key)
        + "\n"
        + str(email or "").strip().casefold()
    )
    return hashlib.sha256(
        payload.encode("utf-8")
    ).hexdigest()


def _protect_windows(data: bytes) -> bytes:
    """Encrypts data with Windows DPAPI for the current Windows user."""

    if os.name != "nt":
        raise RuntimeError(
            "Gespeicherte Supabase-Sitzungen werden aktuell nur unter "
            "Windows verschlüsselt unterstützt."
        )

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    buffer = ctypes.create_string_buffer(data)
    input_blob = _DataBlob(
        len(data),
        ctypes.cast(
            buffer,
            ctypes.POINTER(ctypes.c_ubyte),
        ),
    )
    output_blob = _DataBlob()

    # CRYPTPROTECT_UI_FORBIDDEN
    flags = 0x1

    if not crypt32.CryptProtectData(
        ctypes.byref(input_blob),
        "ITAssetFlow Supabase Session",
        None,
        None,
        None,
        flags,
        ctypes.byref(output_blob),
    ):
        raise ctypes.WinError()

    try:
        return ctypes.string_at(
            output_blob.pbData,
            output_blob.cbData,
        )
    finally:
        kernel32.LocalFree(output_blob.pbData)


def _unprotect_windows(data: bytes) -> bytes:
    """Decrypts data previously encrypted with Windows DPAPI."""

    if os.name != "nt":
        raise RuntimeError(
            "Gespeicherte Supabase-Sitzungen werden aktuell nur unter "
            "Windows verschlüsselt unterstützt."
        )

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    buffer = ctypes.create_string_buffer(data)
    input_blob = _DataBlob(
        len(data),
        ctypes.cast(
            buffer,
            ctypes.POINTER(ctypes.c_ubyte),
        ),
    )
    output_blob = _DataBlob()

    flags = 0x1

    if not crypt32.CryptUnprotectData(
        ctypes.byref(input_blob),
        None,
        None,
        None,
        None,
        flags,
        ctypes.byref(output_blob),
    ):
        raise ctypes.WinError()

    try:
        return ctypes.string_at(
            output_blob.pbData,
            output_blob.cbData,
        )
    finally:
        kernel32.LocalFree(output_blob.pbData)


class AuthSessionStore:
    """Stores remembered Supabase logins locally.

    Passwords are never stored. On Windows, access and refresh tokens are
    encrypted through DPAPI and can only be decrypted by the same Windows
    user account.
    """

    SETTINGS_KEY = "auth/saved_logins_v1"

    def __init__(self) -> None:
        self.settings = QSettings(
            "DLC-Informatik GmbH",
            "ITAssetFlow",
        )

    @property
    def supports_secure_session_storage(self) -> bool:
        return os.name == "nt"

    def list_logins(
        self,
        supabase_url: str,
        supabase_key: str,
    ) -> list[SavedLogin]:
        url = _normalize_url(supabase_url)
        fingerprint = _key_fingerprint(supabase_key)

        rows = self._load_rows()

        result: list[SavedLogin] = []
        for profile_id, row in rows.items():
            if not isinstance(row, dict):
                continue

            if _normalize_url(row.get("supabase_url")) != url:
                continue

            if row.get("key_fingerprint") != fingerprint:
                continue

            email = str(
                row.get("email")
                or ""
            ).strip()
            if not email:
                continue

            result.append(
                SavedLogin(
                    profile_id=profile_id,
                    email=email,
                )
            )

        return sorted(
            result,
            key=lambda item: item.email.casefold(),
        )

    def save_session(
        self,
        supabase_url: str,
        supabase_key: str,
        email: str,
        access_token: str,
        refresh_token: str,
    ) -> str:
        if not self.supports_secure_session_storage:
            raise RuntimeError(
                "Der Login kann auf diesem Betriebssystem nicht sicher "
                "gespeichert werden."
            )

        normalized_email = str(
            email or ""
        ).strip()
        if not normalized_email:
            raise ValueError("E-Mail-Adresse fehlt.")

        if not access_token or not refresh_token:
            raise ValueError(
                "Supabase hat keine vollständige Sitzung geliefert."
            )

        profile_id = _profile_id(
            supabase_url,
            supabase_key,
            normalized_email,
        )

        secret = json.dumps(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
            },
            ensure_ascii=False,
        ).encode("utf-8")

        encrypted = _protect_windows(secret)

        rows = self._load_rows()
        rows[profile_id] = {
            "email": normalized_email,
            "supabase_url": _normalize_url(
                supabase_url
            ),
            "key_fingerprint": _key_fingerprint(
                supabase_key
            ),
            "encrypted_session": base64.b64encode(
                encrypted
            ).decode("ascii"),
        }

        self._save_rows(rows)
        return profile_id

    def load_session(
        self,
        profile_id: str,
        supabase_url: str,
        supabase_key: str,
    ) -> dict[str, str] | None:
        rows = self._load_rows()
        row = rows.get(profile_id)

        if not isinstance(row, dict):
            return None

        if (
            _normalize_url(row.get("supabase_url"))
            != _normalize_url(supabase_url)
        ):
            return None

        if (
            row.get("key_fingerprint")
            != _key_fingerprint(supabase_key)
        ):
            return None

        encoded = str(
            row.get("encrypted_session")
            or ""
        ).strip()
        if not encoded:
            return None

        try:
            encrypted = base64.b64decode(
                encoded.encode("ascii")
            )
            decrypted = _unprotect_windows(
                encrypted
            )
            payload = json.loads(
                decrypted.decode("utf-8")
            )
        except Exception:
            logger.exception(
                "Saved Supabase session could not be decrypted."
            )
            return None

        if not isinstance(payload, dict):
            return None

        access_token = str(
            payload.get("access_token")
            or ""
        ).strip()
        refresh_token = str(
            payload.get("refresh_token")
            or ""
        ).strip()

        if not access_token or not refresh_token:
            return None

        return {
            "email": str(
                row.get("email")
                or ""
            ).strip(),
            "access_token": access_token,
            "refresh_token": refresh_token,
        }

    def delete_login(
        self,
        profile_id: str,
    ) -> None:
        rows = self._load_rows()
        if profile_id in rows:
            rows.pop(profile_id, None)
            self._save_rows(rows)

    def _load_rows(self) -> dict[str, dict[str, Any]]:
        raw = self.settings.value(
            self.SETTINGS_KEY,
            "{}",
        )

        try:
            data = json.loads(
                str(raw or "{}")
            )
        except (TypeError, ValueError):
            return {}

        return (
            data
            if isinstance(data, dict)
            else {}
        )

    def _save_rows(
        self,
        rows: dict[str, dict[str, Any]],
    ) -> None:
        self.settings.setValue(
            self.SETTINGS_KEY,
            json.dumps(
                rows,
                ensure_ascii=False,
            ),
        )
        self.settings.sync()


NEW_LOGIN_KEY = "__new_login__"


class _LoginWorkerSignals(QObject):
    succeeded = Signal(object)
    failed = Signal(str)


class _LoginWorker(QRunnable):
    def __init__(
        self,
        task: Callable[[], object],
    ) -> None:
        super().__init__()
        self.task = task
        self.signals = _LoginWorkerSignals()

    def run(self) -> None:
        try:
            result = self.task()
        except Exception as error:
            self.signals.failed.emit(str(error))
            return
        self.signals.succeeded.emit(result)


class LoginDialog(QDialog):
    """Loginfenster mit gespeicherten, lokal verschlüsselten Sitzungen."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        self.setObjectName("loginDialog")
        self.setWindowTitle("ITAssetFlow – Anmeldung")
        self.setModal(True)
        self.setMinimumWidth(520)
        self.resize(560, 430)

        self.authenticated_client: Client | None = None
        self.authenticated_email = ""
        self.authenticated_profile_id = ""
        self.connection_url = ""
        self.connection_key = ""

        self._thread_pool = QThreadPool.globalInstance()
        self._active_worker: _LoginWorker | None = None
        self._busy = False
        self._connection_expanded = False

        self._session_store = AuthSessionStore()

        self._build_ui()
        self._load_connection_settings()
        self._connect_signals()
        self._refresh_saved_logins()

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(30, 24, 30, 24)
        root.setSpacing(14)

        self.logo_label = QLabel()
        self.logo_label.setObjectName("loginLogo")
        self.logo_label.setAlignment(
            Qt.AlignmentFlag.AlignCenter
        )
        root.addWidget(self.logo_label)

        login_box = QGroupBox("Anmeldung")
        login_box.setObjectName("loginAccountBox")
        login_form = QFormLayout(login_box)
        login_form.setContentsMargins(16, 18, 16, 16)
        login_form.setHorizontalSpacing(14)
        login_form.setVerticalSpacing(12)

        self.login_selector = QComboBox()
        self.login_selector.setObjectName("loginSelector")

        self.email_input = QLineEdit()
        self.email_input.setPlaceholderText("name@firma.ch")
        self.email_input.setClearButtonEnabled(True)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(
            QLineEdit.EchoMode.Password
        )
        self.password_input.setPlaceholderText("Passwort")

        self.show_password_button = QPushButton(
            "Passwort anzeigen"
        )
        self.show_password_button.setCheckable(True)
        self.show_password_button.setObjectName(
            "loginShowPasswordButton"
        )

        self.login_form = login_form
        login_form.addRow("Login:", self.login_selector)
        login_form.addRow("E-Mail-Adresse:", self.email_input)
        login_form.addRow("Passwort:", self.password_input)
        login_form.addRow("", self.show_password_button)

        root.addWidget(login_box)

        connection_toggle_row = QHBoxLayout()
        self.connection_toggle_button = QPushButton(
            "Supabase Verbindung bearbeiten"
        )
        self.connection_toggle_button.setObjectName(
            "loginConnectionToggle"
        )
        connection_toggle_row.addWidget(
            self.connection_toggle_button
        )
        connection_toggle_row.addStretch()
        root.addLayout(connection_toggle_row)

        self.connection_box = QGroupBox(
            "Supabase-Verbindung"
        )
        self.connection_box.setObjectName(
            "loginConnectionBox"
        )
        self.connection_box.setVisible(False)

        connection_root = QVBoxLayout(
            self.connection_box
        )
        connection_root.setContentsMargins(
            16, 18, 16, 16
        )
        connection_root.setSpacing(10)

        connection_form = QFormLayout()
        connection_form.setHorizontalSpacing(14)
        connection_form.setVerticalSpacing(10)

        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText(
            "https://projekt.supabase.co"
        )

        self.key_input = QLineEdit()
        self.key_input.setPlaceholderText(
            "sb_publishable_..."
        )

        connection_form.addRow(
            "Supabase URL:",
            self.url_input,
        )
        connection_form.addRow(
            "Publishable Key:",
            self.key_input,
        )
        connection_root.addLayout(
            connection_form
        )

        connection_actions = QHBoxLayout()
        self.connection_status = QLabel("")
        self.connection_status.setObjectName(
            "loginConnectionStatus"
        )
        self.connection_status.setWordWrap(True)

        self.test_connection_button = QPushButton(
            "Verbindung testen"
        )
        self.save_connection_button = QPushButton(
            "Speichern"
        )
        self.save_connection_button.setObjectName(
            "primaryButton"
        )

        connection_actions.addWidget(
            self.connection_status,
            1,
        )
        connection_actions.addWidget(
            self.test_connection_button
        )
        connection_actions.addWidget(
            self.save_connection_button
        )
        connection_root.addLayout(
            connection_actions
        )

        self.env_path_label = QLabel("")
        self.env_path_label.setObjectName(
            "loginEnvPath"
        )
        self.env_path_label.setWordWrap(True)
        connection_root.addWidget(
            self.env_path_label
        )

        root.addWidget(
            self.connection_box
        )

        self.status_label = QLabel("")
        self.status_label.setObjectName("loginStatus")
        self.status_label.setWordWrap(True)
        root.addWidget(self.status_label)

        bottom = QHBoxLayout()

        self.remove_login_button = QPushButton(
            "Login entfernen"
        )
        self.remove_login_button.setObjectName(
            "loginRemoveButton"
        )
        self.remove_login_button.setVisible(False)

        bottom.addWidget(
            self.remove_login_button
        )
        bottom.addStretch()

        self.cancel_button = QPushButton(
            "Abbrechen"
        )
        self.login_button = QPushButton(
            "Anmelden"
        )
        self.login_button.setObjectName(
            "primaryButton"
        )
        self.login_button.setDefault(True)

        bottom.addWidget(self.cancel_button)
        bottom.addWidget(self.login_button)
        root.addLayout(bottom)

        self._load_logo()

    def _load_logo(self) -> None:
        candidates: list[Path] = []

        if getattr(sys, "frozen", False):
            executable_dir = Path(
                sys.executable
            ).resolve().parent
            candidates.extend(
                [
                    executable_dir
                    / "resources"
                    / "logo.png",
                    executable_dir
                    / "src"
                    / "resources"
                    / "logo.png",
                ]
            )

        # login_dialog.py = <Projekt>/src/ui/login_dialog.py
        src_dir = (
            Path(__file__)
            .resolve()
            .parent
            .parent
        )
        candidates.append(
            src_dir / "resources" / "logo.png"
        )

        for path in candidates:
            if not path.is_file():
                continue

            pixmap = QPixmap(str(path))
            if pixmap.isNull():
                continue

            self.logo_label.setPixmap(
                pixmap.scaled(
                    260,
                    105,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )
            self.logo_label.setMinimumHeight(90)
            return

        # Nur Fallback, falls die Ressource im Projekt fehlt.
        self.logo_label.setText(
            "ITAssetFlow"
        )
        self.logo_label.setObjectName(
            "loginLogoFallback"
        )

    def _connect_signals(self) -> None:
        self.cancel_button.clicked.connect(
            self.reject
        )
        self.login_button.clicked.connect(
            self._start_login
        )
        self.password_input.returnPressed.connect(
            self._start_login
        )
        self.show_password_button.toggled.connect(
            self._toggle_password_visibility
        )
        self.login_selector.currentIndexChanged.connect(
            self._login_selection_changed
        )
        self.connection_toggle_button.clicked.connect(
            self._toggle_connection_editor
        )
        self.save_connection_button.clicked.connect(
            self._save_connection
        )
        self.test_connection_button.clicked.connect(
            self._test_connection
        )
        self.remove_login_button.clicked.connect(
            self._remove_selected_login
        )

    # ------------------------------------------------------------------
    # Verbindung
    # ------------------------------------------------------------------

    def _load_connection_settings(self) -> None:
        try:
            settings = load_supabase_connection_settings()
        except Exception as error:
            logger.exception(
                "Supabase connection settings could not be loaded."
            )
            self.status_label.setText(
                f"Verbindungseinstellungen konnten nicht geladen werden: {error}"
            )
            self._set_connection_editor_visible(True)
            return

        self.url_input.setText(
            settings.supabase_url
        )
        self.key_input.setText(
            settings.supabase_key
        )
        self.env_path_label.setText(
            f".env: {settings.env_file}"
        )

        if (
            not settings.supabase_url
            or not settings.supabase_key
        ):
            self._set_connection_editor_visible(True)
            self.connection_status.setText(
                "Bitte URL und Publishable Key eintragen."
            )

    @Slot()
    def _toggle_connection_editor(self) -> None:
        self._set_connection_editor_visible(
            not self._connection_expanded
        )

    def _set_connection_editor_visible(
        self,
        visible: bool,
    ) -> None:
        self._connection_expanded = visible
        self.connection_box.setVisible(
            visible
        )
        self.connection_toggle_button.setText(
            "Supabase Verbindung ausblenden"
            if visible
            else "Supabase Verbindung bearbeiten"
        )

        # Dialoghöhe an sichtbaren Inhalt anpassen.
        self.adjustSize()
        self.resize(
            max(self.width(), 560),
            self.sizeHint().height(),
        )

    @Slot()
    def _save_connection(self) -> None:
        if self._busy:
            return

        try:
            env_file = save_supabase_connection_settings(
                self.url_input.text(),
                self.key_input.text(),
            )
        except Exception as error:
            QMessageBox.critical(
                self,
                "Verbindung konnte nicht gespeichert werden",
                str(error),
            )
            return

        self.env_path_label.setText(
            f".env: {env_file}"
        )
        self.connection_status.setText(
            "Verbindungseinstellungen gespeichert."
        )
        self._refresh_saved_logins()

    @Slot()
    def _test_connection(self) -> None:
        if self._busy:
            return

        url = self.url_input.text().strip()
        key = self.key_input.text().strip()

        if not url or not key:
            QMessageBox.information(
                self,
                "Verbindung testen",
                "Bitte Supabase URL und Publishable Key eintragen.",
            )
            return

        self.connection_status.setText(
            "Verbindung wird getestet ..."
        )
        self._start_worker(
            lambda: test_supabase_connection(
                url,
                key,
            ),
            self._connection_test_succeeded,
            self._connection_test_failed,
        )

    @Slot(object)
    def _connection_test_succeeded(
        self,
        result: object,
    ) -> None:
        self._set_busy(False)
        self.connection_status.setText(
            str(result or "Verbindung erfolgreich.")
        )

    @Slot(str)
    def _connection_test_failed(
        self,
        message: str,
    ) -> None:
        self._set_busy(False)
        self.connection_status.setText(
            "Verbindung fehlgeschlagen."
        )
        QMessageBox.critical(
            self,
            "Verbindung fehlgeschlagen",
            message,
        )

    # ------------------------------------------------------------------
    # Gespeicherte Logins
    # ------------------------------------------------------------------

    def _refresh_saved_logins(
        self,
        *,
        preferred_email: str = "",
    ) -> None:
        current_email = (
            preferred_email
            or self.login_selector.currentText()
        )

        self.login_selector.blockSignals(True)
        self.login_selector.clear()

        url = self.url_input.text().strip()
        key = self.key_input.text().strip()

        saved = (
            self._session_store.list_logins(
                url,
                key,
            )
            if url and key
            else []
        )

        for login in saved:
            self.login_selector.addItem(
                login.email,
                login.profile_id,
            )

        self.login_selector.addItem(
            "Anderes Konto ...",
            NEW_LOGIN_KEY,
        )

        selected_index = -1
        if current_email:
            selected_index = (
                self.login_selector.findText(
                    current_email
                )
            )

        if selected_index < 0:
            selected_index = 0

        self.login_selector.setCurrentIndex(
            selected_index
        )
        self.login_selector.blockSignals(False)

        self._login_selection_changed(
            self.login_selector.currentIndex()
        )

    @Slot(int)
    def _login_selection_changed(
        self,
        _index: int,
    ) -> None:
        profile_id = self.login_selector.currentData()
        is_new = profile_id == NEW_LOGIN_KEY

        self.email_input.setVisible(is_new)
        self.password_input.setVisible(is_new)
        self.show_password_button.setVisible(is_new)

        # Labels in QFormLayout separat ein-/ausblenden.
        for widget in (
            self.email_input,
            self.password_input,
            self.show_password_button,
        ):
            label = self.login_form.labelForField(
                widget
            )
            if label is not None:
                label.setVisible(is_new)

        self.remove_login_button.setVisible(
            not is_new
        )

        if is_new:
            self.login_button.setText(
                "Anmelden"
            )
            self.email_input.setFocus()
        else:
            self.login_button.setText(
                "Anmelden"
            )
            self.status_label.setText(
                "Gespeicherten Login auswählen und anmelden."
            )

        self.adjustSize()

    @Slot()
    def _remove_selected_login(self) -> None:
        profile_id = self.login_selector.currentData()
        if not profile_id or profile_id == NEW_LOGIN_KEY:
            return

        email = self.login_selector.currentText()

        answer = QMessageBox.question(
            self,
            "Login entfernen",
            f"Gespeicherten Login „{email}“ von diesem Computer entfernen?",
            QMessageBox.StandardButton.Yes
            | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )

        if answer != QMessageBox.StandardButton.Yes:
            return

        self._session_store.delete_login(
            str(profile_id)
        )
        self._refresh_saved_logins()

    # ------------------------------------------------------------------
    # Anmeldung
    # ------------------------------------------------------------------

    @Slot()
    def _start_login(self) -> None:
        if self._busy:
            return

        url = self.url_input.text().strip()
        key = self.key_input.text().strip()

        if not url or not key:
            self._set_connection_editor_visible(True)
            QMessageBox.information(
                self,
                "Anmeldung",
                "Bitte zuerst die Supabase-Verbindung konfigurieren.",
            )
            return

        profile_id = self.login_selector.currentData()

        if (
            profile_id
            and profile_id != NEW_LOGIN_KEY
        ):
            self._start_saved_login(
                str(profile_id),
                url,
                key,
            )
            return

        email = self.email_input.text().strip()
        password = self.password_input.text()

        if not email or not password:
            QMessageBox.information(
                self,
                "Anmeldung",
                "Bitte E-Mail-Adresse und Passwort eingeben.",
            )
            return

        self.status_label.setText(
            "Anmeldung bei Supabase wird geprüft ..."
        )

        self._start_worker(
            lambda: authenticate_user(
                url,
                key,
                email,
                password,
            ),
            self._password_login_succeeded,
            self._login_failed,
        )

    def _start_saved_login(
        self,
        profile_id: str,
        url: str,
        key: str,
    ) -> None:
        session = self._session_store.load_session(
            profile_id,
            url,
            key,
        )

        if session is None:
            self._session_store.delete_login(
                profile_id
            )
            self._refresh_saved_logins(
                preferred_email=self.login_selector.currentText()
            )
            QMessageBox.information(
                self,
                "Gespeicherter Login",
                "Der gespeicherte Login konnte nicht gelesen werden. "
                "Bitte melde dich erneut mit deinem Passwort an.",
            )
            return

        self.status_label.setText(
            f"{session['email']} wird angemeldet ..."
        )

        self._start_worker(
            lambda: restore_user_session(
                url,
                key,
                session["access_token"],
                session["refresh_token"],
            ),
            self._saved_login_succeeded,
            lambda message: self._saved_login_failed(
                profile_id,
                session["email"],
                message,
            ),
        )

    @Slot(object)
    def _password_login_succeeded(
        self,
        result: object,
    ) -> None:
        self._set_busy(False)

        if (
            not isinstance(result, tuple)
            or len(result) != 2
        ):
            self._login_failed(
                "Supabase hat ein ungültiges Anmeldeergebnis geliefert."
            )
            return

        client, email = result
        self._complete_login(
            client,
            str(email or "").strip(),
        )

    @Slot(object)
    def _saved_login_succeeded(
        self,
        result: object,
    ) -> None:
        self._set_busy(False)

        if (
            not isinstance(result, tuple)
            or len(result) != 2
        ):
            self._login_failed(
                "Der gespeicherte Login konnte nicht wiederhergestellt werden."
            )
            return

        client, email = result
        self._complete_login(
            client,
            str(email or "").strip(),
        )

    def _saved_login_failed(
        self,
        profile_id: str,
        email: str,
        message: str,
    ) -> None:
        self._set_busy(False)
        self._session_store.delete_login(
            profile_id
        )
        self._refresh_saved_logins()

        # Direkt in den manuellen Login wechseln und E-Mail vorbelegen.
        index = self.login_selector.findData(
            NEW_LOGIN_KEY
        )
        self.login_selector.setCurrentIndex(
            index
        )
        self.email_input.setText(email)
        self.password_input.clear()
        self.password_input.setFocus()

        QMessageBox.information(
            self,
            "Erneute Anmeldung erforderlich",
            message,
        )

    @Slot(str)
    def _login_failed(
        self,
        message: str,
    ) -> None:
        self._set_busy(False)
        self.password_input.clear()
        self.password_input.setFocus()

        self.status_label.setText(
            "Anmeldung fehlgeschlagen."
        )

        QMessageBox.critical(
            self,
            "Anmeldung fehlgeschlagen",
            message,
        )

    def _complete_login(
        self,
        client: object,
        email: str,
    ) -> None:
        if not hasattr(client, "auth"):
            self._login_failed(
                "Supabase hat keinen gültigen Client zurückgegeben."
            )
            return

        if not email:
            self._login_failed(
                "Supabase hat keine E-Mail-Adresse zurückgegeben."
            )
            return

        url = self.url_input.text().strip()
        key = self.key_input.text().strip()

        profile_id = ""
        tokens = get_session_tokens(client)

        if (
            tokens is not None
            and self._session_store.supports_secure_session_storage
        ):
            try:
                profile_id = self._session_store.save_session(
                    url,
                    key,
                    email,
                    tokens[0],
                    tokens[1],
                )
            except Exception:
                logger.exception(
                    "Remembering Supabase login failed."
                )

        self.authenticated_client = client
        self.authenticated_email = email
        self.authenticated_profile_id = profile_id
        self.connection_url = url
        self.connection_key = key

        self.accept()

    # ------------------------------------------------------------------
    # Worker / Busy
    # ------------------------------------------------------------------

    def _start_worker(
        self,
        task: Callable[[], object],
        succeeded: Callable[[object], None],
        failed: Callable[[str], None],
    ) -> None:
        self._set_busy(True)

        worker = _LoginWorker(task)
        worker.signals.succeeded.connect(
            succeeded
        )
        worker.signals.failed.connect(
            failed
        )

        self._active_worker = worker
        self._thread_pool.start(worker)

    def _set_busy(
        self,
        busy: bool,
    ) -> None:
        self._busy = busy

        for widget in (
            self.login_selector,
            self.email_input,
            self.password_input,
            self.show_password_button,
            self.connection_toggle_button,
            self.url_input,
            self.key_input,
            self.test_connection_button,
            self.save_connection_button,
            self.remove_login_button,
            self.cancel_button,
        ):
            widget.setEnabled(not busy)

        self.login_button.setEnabled(
            not busy
        )
        if busy:
            self.login_button.setText(
                "Bitte warten ..."
            )
        else:
            self.login_button.setText(
                "Anmelden"
            )

    @Slot(bool)
    def _toggle_password_visibility(
        self,
        visible: bool,
    ) -> None:
        self.password_input.setEchoMode(
            QLineEdit.EchoMode.Normal
            if visible
            else QLineEdit.EchoMode.Password
        )
        self.show_password_button.setText(
            "Passwort ausblenden"
            if visible
            else "Passwort anzeigen"
        )
