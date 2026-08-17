from __future__ import annotations

import base64
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any, Iterable

from supabase import Client


FORMAT_NAME = "ITAssetFlow"
FORMAT_VERSION = 1

# System-/Protokolltabellen werden bewusst nicht importiert/exportiert:
# - audit_log: wird durch normale Schreibvorgänge erneut erzeugt
# - inventory_change_state: technischer Synchronisationszustand
#
# stock_levels / stock_levels_total sind Views und werden aus stock_movements
# automatisch neu berechnet.
TABLE_ORDER: tuple[str, ...] = (
    "organizations",
    "manufacturers",
    "product_categories",
    "sites",
    "departments",
    "site_departments",
    "storage_locations",
    "employees",
    "product_models",
    "software_products",
    "software_licenses",
    "assets",
    "asset_locations",
    "asset_assignments",
    "asset_component_assignments",
    "stock_movements",
    "stock_counts",
    "stock_targets",
    "software_installations",
    "connection_test",
)

PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "organizations": ("id",),
    "manufacturers": ("id",),
    "product_categories": ("id",),
    "sites": ("id",),
    "departments": ("id",),
    "site_departments": ("site_id", "department_id"),
    "storage_locations": ("id",),
    "employees": ("id",),
    "product_models": ("id",),
    "software_products": ("id",),
    "software_licenses": ("id",),
    "assets": ("id",),
    "asset_locations": ("id",),
    "asset_assignments": ("id",),
    "asset_component_assignments": ("id",),
    "stock_movements": ("id",),
    "stock_counts": ("id",),
    "stock_targets": ("product_model_id", "storage_location_id"),
    "software_installations": ("id",),
    "connection_test": ("id",),
}

SEQUENCE_TABLES: tuple[str, ...] = tuple(
    table
    for table, key in PRIMARY_KEYS.items()
    if key == ("id",)
)


class DataTransferService:
    """Round-trip Import/Export für ITAssetFlow.

    CSV ist absichtlich ein *einzelnes* CSV-Paket: jede Zeile enthält
    Tabellenname + JSON-Datensatz. So gehen JSONB-Felder, Fremdschlüssel,
    Datumswerte und unterschiedliche Tabellenschemata verlustfrei in nur
    einer Datei mit .csv-Endung.

    PostgreSQL erzeugt eine echte .sql-Datei mit INSERT/UPSERT-Anweisungen.
    Zusätzlich enthält sie maschinenlesbare Kommentarzeilen, damit ITAssetFlow
    exakt dieselbe Datei wieder sicher importieren kann, ohne beliebiges SQL
    aus einer Datei auszuführen.
    """

    def __init__(self, client: Client) -> None:
        self.client = client

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def export_csv(self, file_path: str | Path) -> dict[str, Any]:
        path = self._prepare_export_path(file_path, ".csv")
        snapshot = self._load_snapshot()

        with path.open(
            "w",
            encoding="utf-8-sig",
            newline="",
        ) as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=(
                    "itassetflow_format",
                    "version",
                    "table",
                    "row_json",
                ),
                quoting=csv.QUOTE_MINIMAL,
            )
            writer.writeheader()

            manifest = self._manifest(snapshot)
            writer.writerow(
                {
                    "itassetflow_format": FORMAT_NAME,
                    "version": FORMAT_VERSION,
                    "table": "__manifest__",
                    "row_json": json.dumps(
                        manifest,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                }
            )

            for table_name in TABLE_ORDER:
                for row in snapshot.get(table_name, []):
                    writer.writerow(
                        {
                            "itassetflow_format": FORMAT_NAME,
                            "version": FORMAT_VERSION,
                            "table": table_name,
                            "row_json": json.dumps(
                                row,
                                ensure_ascii=False,
                                separators=(",", ":"),
                                default=self._json_default,
                            ),
                        }
                    )

        return self._export_result(
            path,
            snapshot,
            "CSV",
        )

    def export_postgresql(
        self,
        file_path: str | Path,
    ) -> dict[str, Any]:
        path = self._prepare_export_path(file_path, ".sql")
        snapshot = self._load_snapshot()
        manifest = self._manifest(snapshot)

        lines: list[str] = [
            "-- ITAssetFlow PostgreSQL Export",
            f"-- Format-Version: {FORMAT_VERSION}",
            (
                "-- ITASSETFLOW-MANIFEST "
                + self._encode_payload(manifest)
            ),
            "",
            "BEGIN;",
            "",
        ]

        for table_name in TABLE_ORDER:
            rows = snapshot.get(table_name, [])
            if not rows:
                continue

            lines.append(
                f"-- Tabelle: {table_name} ({len(rows)} Datensätze)"
            )

            for row in rows:
                lines.append(
                    "-- ITASSETFLOW-DATA "
                    + self._encode_payload(
                        {
                            "table": table_name,
                            "row": row,
                        }
                    )
                )
                lines.append(
                    self._postgres_upsert_sql(
                        table_name,
                        row,
                    )
                )

            lines.append("")

        # Wird die .sql-Datei direkt in PostgreSQL ausgeführt, bleiben auch
        # Sequenzen nach explizit importierten IDs korrekt.
        lines.extend(
            [
                "-- Sequenzen an die höchsten importierten IDs anpassen.",
                *self._sequence_reset_sql(),
                "",
                "COMMIT;",
                "",
            ]
        )

        path.write_text(
            "\n".join(lines),
            encoding="utf-8",
        )

        return self._export_result(
            path,
            snapshot,
            "PostgreSQL",
        )

    # ------------------------------------------------------------------
    # Import
    # ------------------------------------------------------------------

    def import_csv(
        self,
        file_path: str | Path,
    ) -> dict[str, Any]:
        path = Path(file_path)
        if not path.is_file():
            raise ValueError(
                "Die ausgewählte CSV-Datei existiert nicht."
            )

        self._increase_csv_field_limit()

        snapshot: dict[str, list[dict[str, Any]]] = {
            table: []
            for table in TABLE_ORDER
        }
        manifest: dict[str, Any] | None = None

        with path.open(
            "r",
            encoding="utf-8-sig",
            newline="",
        ) as handle:
            reader = csv.DictReader(handle)
            expected = {
                "itassetflow_format",
                "version",
                "table",
                "row_json",
            }

            if (
                reader.fieldnames is None
                or not expected.issubset(
                    set(reader.fieldnames)
                )
            ):
                raise ValueError(
                    "Die CSV-Datei ist kein ITAssetFlow-Export."
                )

            for line_number, record in enumerate(
                reader,
                start=2,
            ):
                if (
                    str(
                        record.get(
                            "itassetflow_format"
                        )
                        or ""
                    ).strip()
                    != FORMAT_NAME
                ):
                    raise ValueError(
                        f"Ungültiges Dateiformat in Zeile {line_number}."
                    )

                try:
                    version = int(
                        str(
                            record.get("version")
                            or ""
                        ).strip()
                    )
                except ValueError as error:
                    raise ValueError(
                        f"Ungültige Format-Version in Zeile {line_number}."
                    ) from error

                self._validate_version(version)

                table_name = str(
                    record.get("table")
                    or ""
                ).strip()

                try:
                    payload = json.loads(
                        record.get("row_json")
                        or ""
                    )
                except json.JSONDecodeError as error:
                    raise ValueError(
                        f"Ungültige JSON-Daten in CSV-Zeile {line_number}."
                    ) from error

                if table_name == "__manifest__":
                    if not isinstance(payload, dict):
                        raise ValueError(
                            "Das CSV-Manifest ist ungültig."
                        )
                    manifest = payload
                    continue

                if table_name not in snapshot:
                    raise ValueError(
                        f"Unbekannte Tabelle im CSV-Export: {table_name}"
                    )
                if not isinstance(payload, dict):
                    raise ValueError(
                        f"Ungültiger Datensatz für Tabelle {table_name}."
                    )

                snapshot[table_name].append(
                    payload
                )

        self._validate_manifest(
            manifest,
        )
        return self._import_snapshot(
            path,
            snapshot,
            "CSV",
        )

    def import_postgresql(
        self,
        file_path: str | Path,
    ) -> dict[str, Any]:
        path = Path(file_path)
        if not path.is_file():
            raise ValueError(
                "Die ausgewählte PostgreSQL-Datei existiert nicht."
            )

        snapshot: dict[str, list[dict[str, Any]]] = {
            table: []
            for table in TABLE_ORDER
        }
        manifest: dict[str, Any] | None = None

        for line_number, raw_line in enumerate(
            path.read_text(
                encoding="utf-8",
            ).splitlines(),
            start=1,
        ):
            line = raw_line.strip()

            if line.startswith(
                "-- ITASSETFLOW-MANIFEST "
            ):
                manifest = self._decode_payload(
                    line.removeprefix(
                        "-- ITASSETFLOW-MANIFEST "
                    ),
                    line_number,
                )
                continue

            if not line.startswith(
                "-- ITASSETFLOW-DATA "
            ):
                continue

            payload = self._decode_payload(
                line.removeprefix(
                    "-- ITASSETFLOW-DATA "
                ),
                line_number,
            )

            if not isinstance(payload, dict):
                raise ValueError(
                    f"Ungültige Importdaten in Zeile {line_number}."
                )

            table_name = str(
                payload.get("table")
                or ""
            ).strip()
            row = payload.get("row")

            if table_name not in snapshot:
                raise ValueError(
                    f"Unbekannte Tabelle im PostgreSQL-Export: {table_name}"
                )
            if not isinstance(row, dict):
                raise ValueError(
                    f"Ungültiger Datensatz in Zeile {line_number}."
                )

            snapshot[table_name].append(
                row
            )

        self._validate_manifest(
            manifest,
        )
        return self._import_snapshot(
            path,
            snapshot,
            "PostgreSQL",
        )

    # ------------------------------------------------------------------
    # Snapshot
    # ------------------------------------------------------------------

    def _load_snapshot(
        self,
    ) -> dict[str, list[dict[str, Any]]]:
        result: dict[
            str,
            list[dict[str, Any]],
        ] = {}

        for table_name in TABLE_ORDER:
            response = (
                self.client.table(table_name)
                .select("*")
                .execute()
            )
            data = getattr(
                response,
                "data",
                None,
            )

            rows = (
                [
                    dict(row)
                    for row in data
                    if isinstance(row, dict)
                ]
                if isinstance(data, list)
                else []
            )

            result[table_name] = rows

        return result

    def _import_snapshot(
        self,
        path: Path,
        snapshot: dict[str, list[dict[str, Any]]],
        format_label: str,
    ) -> dict[str, Any]:
        total_rows = sum(
            len(snapshot.get(table, []))
            for table in TABLE_ORDER
        )
        if total_rows <= 0:
            raise ValueError(
                "Die Importdatei enthält keine ITAssetFlow-Datensätze."
            )

        imported = 0

        for table_name in TABLE_ORDER:
            rows = [
                dict(row)
                for row in snapshot.get(
                    table_name,
                    [],
                )
                if isinstance(row, dict)
            ]
            if not rows:
                continue

            if table_name == "storage_locations":
                imported += self._upsert_storage_locations(
                    rows
                )
                continue

            imported += self._upsert_rows(
                table_name,
                rows,
            )

        return {
            "format": format_label,
            "path": str(path),
            "imported_rows": imported,
            "table_count": sum(
                1
                for table in TABLE_ORDER
                if snapshot.get(table)
            ),
        }

    def _upsert_storage_locations(
        self,
        rows: list[dict[str, Any]],
    ) -> int:
        # parent_location_id ist ein Self-FK. Beim ersten Durchlauf werden
        # alle Datensätze ohne Parent-Beziehung angelegt/aktualisiert.
        # Im zweiten Durchlauf werden die echten Parent-IDs wieder gesetzt.
        first_pass = []
        for row in rows:
            current = dict(row)
            current["parent_location_id"] = None
            first_pass.append(current)

        self._upsert_rows(
            "storage_locations",
            first_pass,
        )
        self._upsert_rows(
            "storage_locations",
            rows,
        )
        return len(rows)

    def _upsert_rows(
        self,
        table_name: str,
        rows: list[dict[str, Any]],
    ) -> int:
        if table_name not in PRIMARY_KEYS:
            raise ValueError(
                f"Für Tabelle {table_name} ist kein Primärschlüssel definiert."
            )

        conflict_columns = ",".join(
            PRIMARY_KEYS[table_name]
        )

        for batch in self._batches(
            rows,
            100,
        ):
            (
                self.client.table(table_name)
                .upsert(
                    batch,
                    on_conflict=conflict_columns,
                )
                .execute()
            )

        return len(rows)

    # ------------------------------------------------------------------
    # Format / SQL
    # ------------------------------------------------------------------

    def _manifest(
        self,
        snapshot: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        return {
            "format": FORMAT_NAME,
            "version": FORMAT_VERSION,
            "exported_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "tables": [
                {
                    "name": table,
                    "rows": len(
                        snapshot.get(
                            table,
                            [],
                        )
                    ),
                }
                for table in TABLE_ORDER
            ],
            "excluded": [
                "audit_log",
                "inventory_change_state",
                "stock_levels",
                "stock_levels_total",
            ],
        }

    @staticmethod
    def _postgres_upsert_sql(
        table_name: str,
        row: dict[str, Any],
    ) -> str:
        if not row:
            return ""

        columns = list(row)
        quoted_columns = ", ".join(
            DataTransferService._quote_identifier(
                column
            )
            for column in columns
        )
        values = ", ".join(
            DataTransferService._sql_literal(
                row[column]
            )
            for column in columns
        )

        primary_key = PRIMARY_KEYS[
            table_name
        ]
        conflict = ", ".join(
            DataTransferService._quote_identifier(
                column
            )
            for column in primary_key
        )

        update_columns = [
            column
            for column in columns
            if column not in primary_key
        ]

        if update_columns:
            update_sql = ", ".join(
                (
                    f"{DataTransferService._quote_identifier(column)} = "
                    f"EXCLUDED.{DataTransferService._quote_identifier(column)}"
                )
                for column in update_columns
            )
            on_conflict = (
                f"ON CONFLICT ({conflict}) "
                f"DO UPDATE SET {update_sql}"
            )
        else:
            on_conflict = (
                f"ON CONFLICT ({conflict}) DO NOTHING"
            )

        return (
            f"INSERT INTO public."
            f"{DataTransferService._quote_identifier(table_name)} "
            f"({quoted_columns}) VALUES ({values}) "
            f"{on_conflict};"
        )

    @staticmethod
    def _sequence_reset_sql() -> list[str]:
        result: list[str] = []

        for table_name in SEQUENCE_TABLES:
            quoted = DataTransferService._quote_identifier(
                table_name
            )
            result.append(
                "SELECT setval("
                f"pg_get_serial_sequence('public.{table_name}', 'id'), "
                f"GREATEST(COALESCE((SELECT MAX(id) FROM public.{quoted}), 1), 1), "
                "true"
                ");"
            )

        return result

    @staticmethod
    def _sql_literal(
        value: Any,
    ) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, (dict, list)):
            text = json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
                default=DataTransferService._json_default,
            )
            escaped = text.replace(
                "'",
                "''",
            )
            return f"'{escaped}'::jsonb"

        text = str(value).replace(
            "'",
            "''",
        )
        return f"'{text}'"

    @staticmethod
    def _quote_identifier(
        name: str,
    ) -> str:
        return (
            '"'
            + str(name).replace(
                '"',
                '""',
            )
            + '"'
        )

    @staticmethod
    def _encode_payload(
        value: Any,
    ) -> str:
        raw = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            default=DataTransferService._json_default,
        ).encode("utf-8")
        return base64.b64encode(
            raw
        ).decode("ascii")

    @staticmethod
    def _decode_payload(
        encoded: str,
        line_number: int,
    ) -> Any:
        try:
            raw = base64.b64decode(
                encoded.encode("ascii"),
                validate=True,
            )
            return json.loads(
                raw.decode("utf-8")
            )
        except (
            ValueError,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ) as error:
            raise ValueError(
                f"Ungültige ITAssetFlow-Daten in Zeile {line_number}."
            ) from error

    # ------------------------------------------------------------------
    # Validierung / Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_manifest(
        manifest: dict[str, Any] | None,
    ) -> None:
        if not isinstance(
            manifest,
            dict,
        ):
            raise ValueError(
                "Die Datei enthält kein gültiges ITAssetFlow-Manifest."
            )

        if (
            str(
                manifest.get("format")
                or ""
            ).strip()
            != FORMAT_NAME
        ):
            raise ValueError(
                "Die Datei ist kein ITAssetFlow-Export."
            )

        try:
            version = int(
                manifest.get("version")
            )
        except (
            TypeError,
            ValueError,
        ) as error:
            raise ValueError(
                "Die Exportdatei besitzt keine gültige Format-Version."
            ) from error

        DataTransferService._validate_version(
            version
        )

    @staticmethod
    def _validate_version(
        version: int,
    ) -> None:
        if version != FORMAT_VERSION:
            raise ValueError(
                "Diese Exportdatei verwendet die nicht unterstützte "
                f"Format-Version {version}. Unterstützt wird Version "
                f"{FORMAT_VERSION}."
            )

    @staticmethod
    def _prepare_export_path(
        file_path: str | Path,
        suffix: str,
    ) -> Path:
        path = Path(file_path)
        if path.suffix.casefold() != suffix.casefold():
            path = path.with_suffix(
                suffix
            )

        path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )
        return path

    @staticmethod
    def _export_result(
        path: Path,
        snapshot: dict[str, list[dict[str, Any]]],
        format_label: str,
    ) -> dict[str, Any]:
        return {
            "format": format_label,
            "path": str(path),
            "exported_rows": sum(
                len(snapshot.get(table, []))
                for table in TABLE_ORDER
            ),
            "table_count": sum(
                1
                for table in TABLE_ORDER
                if snapshot.get(table)
            ),
        }

    @staticmethod
    def _batches(
        rows: list[dict[str, Any]],
        size: int,
    ) -> Iterable[list[dict[str, Any]]]:
        for index in range(
            0,
            len(rows),
            size,
        ):
            yield rows[
                index : index + size
            ]

    @staticmethod
    def _json_default(
        value: Any,
    ) -> str:
        if hasattr(
            value,
            "isoformat",
        ):
            return value.isoformat()
        return str(value)

    @staticmethod
    def _increase_csv_field_limit() -> None:
        limit = sys.maxsize
        while True:
            try:
                csv.field_size_limit(
                    limit
                )
                return
            except OverflowError:
                limit //= 10