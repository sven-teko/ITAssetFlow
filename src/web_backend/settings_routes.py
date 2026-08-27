from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from inventory import (
    DEFAULT_VISIBLE_COLUMNS,
    HEADER_LABELS,
    INVENTORY_GROUP_LABELS,
    PREFERRED_COLUMN_ORDER,
)


class SettingsService:
    """Supabase-Zugriffe für Datei > Einstellungen.

    Die Stammdaten werden hierarchisch gespeichert:
    Standort -> Abteilung -> Lagerort. Neue Einträge verwenden temporäre
    ``client_key``-Referenzen, damit Standort, Abteilung und Lagerort gemeinsam
    mit einem einzigen Klick auf „Übernehmen“ angelegt werden können.
    """

    def __init__(self, client: Client) -> None:
        self.client = client

    def load(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "sites": self._load_rows(
                "sites",
                "id,name,street,street_number,postal_code,city,country,organization_id",
            ),
            "departments": self._load_rows(
                "departments",
                "id,name,organization_id,site_id",
            ),
            "storage_locations": [
                row
                for row in self._load_rows(
                    "storage_locations",
                    (
                        "id,site_id,department_id,name,parent_location_id,"
                        "location_type,code,is_active"
                    ),
                )
                if bool(row.get("is_active", True))
            ],
            "product_categories": self._load_rows(
                "product_categories",
                "id,name,code,inventory_group,specification_schema",
            ),
            "employees": self._load_rows(
                "employees",
                (
                    "id,employee_number,first_name,last_name,email,"
                    "department_id,is_active,auth_user_id,app_role"
                ),
                order_column="last_name",
            ),
            "manufacturers": self._load_rows(
                "manufacturers",
                "id,name",
            ),
        }

    def save(self, payload: dict[str, Any]) -> dict[str, bool]:
        if not isinstance(payload, dict):
            raise ValueError("Ungültige Einstellungsdaten.")

        # Vor sämtlichen Änderungen prüfen, ob ein zum Löschen markierter
        # Stammdatensatz noch verwendet wird. Dadurch entstehen bei einem
        # fehlgeschlagenen Löschen keine teilweise gespeicherten Änderungen.
        self._validate_deletions(
            payload.get("deleted")
        )

        site_ids = self._save_sites(payload.get("sites"))
        department_ids = self._save_departments(
            payload.get("departments"),
            site_ids,
        )
        self._save_employees(
            payload.get("employees"),
            department_ids,
        )
        self._save_locations(
            payload.get("storage_locations"),
            site_ids,
            department_ids,
        )
        self._save_categories(payload.get("product_categories"))
        self._save_manufacturers(payload.get("manufacturers"))
        self._delete_marked(payload.get("deleted"))
        return {"saved": True}

    def _load_rows(
        self,
        table_name: str,
        select_expression: str,
        *,
        order_column: str = "name",
    ) -> list[dict[str, Any]]:
        response = (
            self.client.table(table_name)
            .select(select_expression)
            .order(order_column)
            .execute()
        )
        data = getattr(response, "data", None)
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

    def _save_sites(self, rows: object) -> dict[str, Any]:
        mapping: dict[str, Any] = {}
        if not isinstance(rows, list):
            return mapping

        default_org = None
        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Standortname fehlt.")

            row_id = item.get("id")
            organization_id = item.get("organization_id")
            if organization_id is None:
                if default_org is None:
                    default_org = self._get_default_organization_id()
                organization_id = default_org

            row = {
                "name": name,
                "street": self._none_if_blank(item.get("street")),
                "street_number": self._none_if_blank(item.get("street_number")),
                "postal_code": self._none_if_blank(item.get("postal_code")),
                "city": self._none_if_blank(item.get("city")),
                "country": self._none_if_blank(item.get("country")),
                "organization_id": organization_id,
            }

            if row_id is None:
                response = self.client.table("sites").insert(row).execute()
                row_id = self._inserted_id(response, "Standort")
            else:
                self.client.table("sites").update(row).eq("id", row_id).execute()

            client_key = str(item.get("client_key") or f"id:{row_id}")
            mapping[client_key] = row_id
        return mapping

    def _save_departments(
        self,
        rows: object,
        site_ids: dict[str, Any],
    ) -> dict[str, Any]:
        mapping: dict[str, Any] = {}
        if not isinstance(rows, list):
            return mapping

        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Abteilungsname fehlt.")

            site_id = self._resolve_ref(
                item.get("site_ref"),
                site_ids,
                "Standort der Abteilung",
            )
            organization_id = item.get("organization_id")
            if organization_id is None:
                organization_id = self._organization_for_site(site_id)

            row = {
                "name": name,
                "organization_id": organization_id,
                "site_id": site_id,
            }
            row_id = item.get("id")
            if row_id is None:
                response = self.client.table("departments").insert(row).execute()
                row_id = self._inserted_id(response, "Abteilung")
            else:
                self.client.table("departments").update(row).eq("id", row_id).execute()

            client_key = str(item.get("client_key") or f"id:{row_id}")
            mapping[client_key] = row_id
        return mapping

    def _save_locations(
        self,
        rows: object,
        site_ids: dict[str, Any],
        department_ids: dict[str, Any],
    ) -> None:
        if not isinstance(rows, list):
            return

        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Lagerortname fehlt.")

            department_id = self._resolve_ref(
                item.get("department_ref"),
                department_ids,
                "Abteilung des Lagerorts",
            )
            site_id = self._resolve_ref(
                item.get("site_ref"),
                site_ids,
                "Standort des Lagerorts",
            )
            location_type = str(item.get("location_type") or "warehouse").strip().casefold()
            if location_type not in {"warehouse", "area", "room"}:
                raise ValueError(f"Lagerort „{name}“ besitzt einen ungültigen Typ.")

            row = {
                "site_id": site_id,
                "department_id": department_id,
                "name": name,
                "parent_location_id": item.get("parent_location_id"),
                "location_type": location_type,
                "code": self._none_if_blank(item.get("code")),
                "is_active": True,
            }
            row_id = item.get("id")
            if row_id is None:
                self.client.table("storage_locations").insert(row).execute()
            else:
                self.client.table("storage_locations").update(row).eq("id", row_id).execute()

    def _save_employees(
        self,
        rows: object,
        department_ids: dict[str, Any],
    ) -> None:
        if not isinstance(rows, list):
            return

        for item in rows:
            if not isinstance(item, dict):
                continue

            first_name = str(
                item.get("first_name")
                or ""
            ).strip()
            last_name = str(
                item.get("last_name")
                or ""
            ).strip()

            if not first_name or not last_name:
                raise ValueError(
                    "Mitarbeiter benötigen Vorname und Nachname."
                )

            department_ref = item.get("department_ref")
            department_id = None
            if str(department_ref or "").strip():
                department_id = self._resolve_ref(
                    department_ref,
                    department_ids,
                    "Abteilung des Mitarbeiters",
                )

            row = {
                "employee_number": self._none_if_blank(
                    item.get("employee_number")
                ),
                "first_name": first_name,
                "last_name": last_name,
                "email": self._none_if_blank(
                    item.get("email")
                ),
                "department_id": department_id,
                "is_active": bool(
                    item.get("is_active", True)
                ),
            }

            row_id = item.get("id")
            if row_id is None:
                # Neue Mitarbeiter erhalten bewusst keine Auth-Verknüpfung.
                # app_role verwendet den DB-Default "user".
                self.client.table("employees").insert(row).execute()
            else:
                # auth_user_id und app_role werden hier absichtlich NICHT
                # verändert. Damit kann das Einstellungsfenster keine
                # Benutzer-/Admin-Verknüpfung beschädigen.
                (
                    self.client.table("employees")
                    .update(row)
                    .eq("id", row_id)
                    .execute()
                )

    def _save_categories(self, rows: object) -> None:
        if not isinstance(rows, list):
            return
        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            code = str(item.get("code") or "").strip()
            if not name or not code:
                raise ValueError("Kategorie benötigt Name und technischen Code.")
            schema = item.get("specification_schema")
            if not isinstance(schema, dict):
                schema = {"fields": []}
            row = {
                "name": name,
                "code": code,
                "inventory_group": str(item.get("inventory_group") or "other").strip().casefold(),
                "specification_schema": schema,
            }
            row_id = item.get("id")
            if row_id is None:
                self.client.table("product_categories").insert(row).execute()
            else:
                self.client.table("product_categories").update(row).eq("id", row_id).execute()

    def _save_manufacturers(self, rows: object) -> None:
        if not isinstance(rows, list):
            return
        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Herstellername fehlt.")
            row_id = item.get("id")
            if row_id is None:
                self.client.table("manufacturers").insert({"name": name}).execute()
            else:
                self.client.table("manufacturers").update({"name": name}).eq("id", row_id).execute()

    def _validate_deletions(
        self,
        deleted: object,
    ) -> None:
        """Verhindert das Löschen noch verwendeter Stammdaten.

        Die Supabase-Fremdschlüssel würden diese Löschungen ohnehin ablehnen.
        Die Vorprüfung findet das aber *bevor* andere Einstellungsänderungen
        gespeichert werden und liefert eine verständliche Meldung.
        """

        if not isinstance(deleted, dict):
            return

        checks = {
            # Lagerorte werden beim Entfernen archiviert (is_active = false).
            # Historische Asset-Standorte und Lagerbewegungen dürfen deshalb
            # bestehen bleiben und blockieren das Entfernen nicht.
            "storage_locations": (),
            "departments": (
                ("asset_assignments", "department_id", "Asset-Zuordnungen"),
                ("employees", "department_id", "Mitarbeitende"),
                ("stock_movements", "department_id", "Lagerbewegungen"),
                ("storage_locations", "department_id", "Lagerorte"),
                ("site_departments", "department_id", "Standort-Zuordnungen"),
            ),
            "sites": (
                ("departments", "site_id", "Abteilungen"),
                ("storage_locations", "site_id", "Lagerorte"),
                ("site_departments", "site_id", "Abteilungs-Zuordnungen"),
            ),
            "employees": (
                ("asset_assignments", "employee_id", "Asset-Zuweisungen"),
                ("asset_assignments", "changed_by_employee_id", "Änderungshistorie"),
                ("asset_locations", "changed_by_employee_id", "Standort-Historie"),
                ("software_installations", "recorded_by_employee_id", "Software-Installationen"),
                ("stock_counts", "counted_by_employee_id", "Bestandszählungen"),
                ("stock_movements", "performed_by_employee_id", "Lagerbewegungen"),
            ),
            "product_categories": (
                ("product_models", "category_id", "Produktmodelle"),
            ),
            "manufacturers": (
                ("product_models", "manufacturer_id", "Produktmodelle"),
            ),
        }

        labels = {
            "storage_locations": "Lagerort",
            "departments": "Abteilung",
            "sites": "Standort",
            "employees": "Mitarbeiter",
            "product_categories": "Kategorie",
            "manufacturers": "Hersteller",
        }

        problems: list[str] = []

        for table_name, dependencies in checks.items():
            ids = deleted.get(table_name)
            if not isinstance(ids, list):
                continue

            for row_id in ids:
                if row_id is None:
                    continue

                name = self._row_name(
                    table_name,
                    row_id,
                )

                used_by: list[str] = []

                if table_name == "storage_locations":
                    current_assets = self._current_asset_location_count(row_id)
                    current_stock = self._current_stock_quantity(row_id)
                    child_locations = self._reference_count(
                        "storage_locations",
                        "parent_location_id",
                        row_id,
                    )
                    stock_targets = self._reference_count(
                        "stock_targets",
                        "storage_location_id",
                        row_id,
                    )

                    if current_assets:
                        used_by.append(
                            f"{current_assets} aktuell zugeordnete Asset"
                            + ("" if current_assets == 1 else "s")
                        )
                    if current_stock > 0:
                        used_by.append(
                            f"aktueller Mengenbestand: {current_stock:g}"
                        )
                    if child_locations:
                        used_by.append(
                            f"{child_locations} untergeordnete Lagerorte"
                        )
                    if stock_targets:
                        used_by.append(
                            f"{stock_targets} Bestandsziel"
                            + ("" if stock_targets == 1 else "e")
                        )

                if (
                    table_name == "employees"
                    and self._employee_auth_linked(row_id)
                ):
                    used_by.append("Benutzerkonto / Anmeldung")

                for dependency_table, column, description in dependencies:
                    if self._has_reference(
                        dependency_table,
                        column,
                        row_id,
                    ):
                        if description not in used_by:
                            used_by.append(description)

                if used_by:
                    problems.append(
                        f"{labels.get(table_name, table_name)} "
                        f"„{name}“ kann nicht gelöscht werden "
                        f"(verwendet durch: {', '.join(used_by)})."
                    )

        if problems:
            raise ValueError(
                "Die Änderungen konnten noch nicht übernommen werden.\n\n"
                "Folgende Einträge werden aktuell noch verwendet:\n\n"
                + "\n".join(
                    f"• {problem}"
                    for problem in problems
                )
                + "\n\nBitte ändere zuerst die genannten Zuordnungen "
                "und versuche es danach erneut."
            )

    def _current_asset_location_count(
        self,
        storage_location_id: Any,
    ) -> int:
        response = (
            self.client.table("asset_locations")
            .select("id")
            .eq("storage_location_id", storage_location_id)
            .is_("valid_to", "null")
            .execute()
        )
        data = getattr(response, "data", None)
        return len(data) if isinstance(data, list) else 0

    def _current_stock_quantity(
        self,
        storage_location_id: Any,
    ) -> float:
        response = (
            self.client.table("stock_levels")
            .select("quantity")
            .eq("storage_location_id", storage_location_id)
            .execute()
        )
        data = getattr(response, "data", None)

        total = 0.0
        if isinstance(data, list):
            for row in data:
                if not isinstance(row, dict):
                    continue
                try:
                    total += float(row.get("quantity") or 0)
                except (TypeError, ValueError):
                    continue

        return max(total, 0.0)

    def _reference_count(
        self,
        table_name: str,
        column_name: str,
        row_id: Any,
    ) -> int:
        response = (
            self.client.table(table_name)
            .select(column_name)
            .eq(column_name, row_id)
            .execute()
        )
        data = getattr(response, "data", None)
        return len(data) if isinstance(data, list) else 0

    def _has_reference(
        self,
        table_name: str,
        column_name: str,
        row_id: Any,
    ) -> bool:
        response = (
            self.client
            .table(table_name)
            .select(column_name)
            .eq(column_name, row_id)
            .limit(1)
            .execute()
        )

        data = getattr(
            response,
            "data",
            None,
        )
        return bool(
            isinstance(data, list)
            and data
        )

    def _row_name(
        self,
        table_name: str,
        row_id: Any,
    ) -> str:
        select_expression = (
            "first_name,last_name"
            if table_name == "employees"
            else "name"
        )

        response = (
            self.client
            .table(table_name)
            .select(select_expression)
            .eq("id", row_id)
            .limit(1)
            .execute()
        )
        data = getattr(
            response,
            "data",
            None,
        )

        if (
            isinstance(data, list)
            and data
            and isinstance(data[0], dict)
        ):
            if table_name == "employees":
                name = " ".join(
                    part
                    for part in (
                        str(data[0].get("first_name") or "").strip(),
                        str(data[0].get("last_name") or "").strip(),
                    )
                    if part
                )
            else:
                name = str(
                    data[0].get("name")
                    or ""
                ).strip()

            if name:
                return name

        return f"ID {row_id}"

    def _employee_auth_linked(
        self,
        employee_id: Any,
    ) -> bool:
        response = (
            self.client.table("employees")
            .select("auth_user_id")
            .eq("id", employee_id)
            .limit(1)
            .execute()
        )
        data = getattr(response, "data", None)
        return bool(
            isinstance(data, list)
            and data
            and isinstance(data[0], dict)
            and data[0].get("auth_user_id") is not None
        )

    def _delete_marked(self, deleted: object) -> None:
        if not isinstance(deleted, dict):
            return
        # Von unten nach oben löschen: Lagerort -> Abteilung -> Standort.
        for table_name in (
            "storage_locations",
            "employees",
            "departments",
            "sites",
            "product_categories",
            "manufacturers",
        ):
            ids = deleted.get(table_name)
            if not isinstance(ids, list):
                continue
            for row_id in ids:
                if row_id is None:
                    continue

                if table_name == "storage_locations":
                    # Lagerorte enthalten Historie über asset_locations und
                    # stock_movements. Deshalb fachlich "löschen", technisch
                    # aber archivieren. So bleibt die Historie vollständig.
                    (
                        self.client.table("storage_locations")
                        .update({"is_active": False})
                        .eq("id", row_id)
                        .execute()
                    )
                    continue

                self.client.table(table_name).delete().eq("id", row_id).execute()

    @staticmethod
    def _none_if_blank(value: Any) -> Any | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _inserted_id(response: object, label: str) -> Any:
        data = getattr(response, "data", None)
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        if not rows or rows[0].get("id") is None:
            raise RuntimeError(f"Supabase hat für {label} keine ID zurückgegeben.")
        return rows[0]["id"]

    @staticmethod
    def _resolve_ref(ref: Any, mapping: dict[str, Any], label: str) -> Any:
        key = str(ref or "").strip()
        if not key:
            raise ValueError(f"{label} fehlt.")
        if key in mapping:
            return mapping[key]
        if key.startswith("id:"):
            raw = key[3:]
            try:
                return int(raw)
            except ValueError:
                return raw
        raise ValueError(f"{label} konnte nicht aufgelöst werden.")

    def _organization_for_site(self, site_id: Any) -> Any:
        response = (
            self.client.table("sites")
            .select("organization_id")
            .eq("id", site_id)
            .limit(1)
            .execute()
        )
        data = getattr(response, "data", None)
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        if rows and rows[0].get("organization_id") is not None:
            return rows[0]["organization_id"]
        return self._get_default_organization_id()

    def _get_default_organization_id(self) -> Any:
        response = (
            self.client.table("organizations")
            .select("id")
            .order("id")
            .limit(1)
            .execute()
        )
        data = getattr(response, "data", None)
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        if not rows or rows[0].get("id") is None:
            raise RuntimeError("Es ist keine Organisation vorhanden.")
        return rows[0]["id"]



def create_settings_router(
    get_web_session: Callable[..., Any],
) -> APIRouter:
    """Erzeugt die Web-Routen für Datei > Einstellungen.

    Die Datenbanklogik entspricht bewusst dem nativen SettingsDialog.
    Die Standardspalten sind im Web benutzerspezifische Browser-Einstellungen
    und werden deshalb im React-Frontend gespeichert.
    """

    router = APIRouter(
        prefix="/api/settings",
        tags=["settings"],
    )

    @router.get("")
    def load_settings(
        web_session: Any = Depends(get_web_session),
    ) -> dict[str, Any]:
        try:
            data = SettingsService(
                web_session.client
            ).load()
        except Exception as error:
            raise HTTPException(
                status_code=500,
                detail=str(error),
            ) from error

        data["column_order"] = list(
            PREFERRED_COLUMN_ORDER
        )
        data["headers"] = dict(
            HEADER_LABELS
        )
        data["factory_default_visible_columns"] = [
            column
            for column in PREFERRED_COLUMN_ORDER
            if column in DEFAULT_VISIBLE_COLUMNS
        ]
        data["inventory_group_labels"] = dict(
            INVENTORY_GROUP_LABELS
        )

        return data

    @router.put("")
    def save_settings(
        payload: dict[str, Any],
        web_session: Any = Depends(get_web_session),
    ) -> dict[str, bool]:
        database_payload = dict(
            payload
        )

        # Standardspalten sind keine gemeinsamen Stammdaten.
        # Sie werden pro angemeldetem Web-Benutzer im Browser gespeichert.
        database_payload.pop(
            "default_visible_columns",
            None,
        )

        try:
            return SettingsService(
                web_session.client
            ).save(
                database_payload
            )
        except ValueError as error:
            raise HTTPException(
                status_code=400,
                detail=str(error),
            ) from error
        except Exception as error:
            raise HTTPException(
                status_code=500,
                detail=str(error),
            ) from error

    return router
