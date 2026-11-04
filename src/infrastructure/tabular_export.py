"""Readable tabular formats for the same permission-scoped transfer snapshot."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from itertools import chain
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from inventory import HEADER_LABELS

SHEET_NAMES = {
    "assets": "Einzelartikel", "product_models": "Produktmodelle",
    "product_categories": "Produktkategorien", "manufacturers": "Hersteller",
    "sites": "Standorte", "departments": "Abteilungen", "storage_locations": "Lagerorte",
    "employees": "Mitarbeiter", "employee_site_access": "Standortfreigaben",
    "organizations": "Organisationen", "site_departments": "Standortabteilungen",
    "inventory_archive": "Archiv", "inventory_images": "Artikelbilder",
    "asset_locations": "Standortverlauf", "asset_assignments": "Zuweisungen",
    "asset_component_assignments": "Produktverbindungen", "stock_movements": "Lagerbewegungen",
    "stock_counts": "Inventurzählungen", "stock_targets": "Mindestbestände",
    "software_products": "Softwareprodukte", "software_licenses": "Softwarelizenzen",
    "software_installations": "Softwareinstallationen", "connection_test": "Verbindungstest",
    "inventory_stock_levels": "Lagerbestand",
}
FRONT_SHEETS = ("assets", "inventory_stock_levels", "product_models", "stock_movements", "sites", "departments", "storage_locations")
XLSX_MAX_ROWS = 1_048_576
CHUNK_LENGTH = 15_000  # Also fits within Excel's limit for UTF-16 surrogate pairs.


def columns_for(rows: list[dict], keys: tuple[str, ...]) -> list[str]:
    return list(dict.fromkeys(chain(keys, chain.from_iterable(rows))))


def serialized_value(value) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=serialized_value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, bytes):
        return "\\x" + value.hex()
    return str(value)


def csv_cell(value) -> str:
    # An unquoted empty field is NULL; a quoted empty field is the empty string.
    return "" if value is None else '"' + serialized_value(value).replace('"', '""') + '"'


def write_csv_tables(path: Path, snapshot: dict[str, list[dict]], primary_keys: dict) -> None:
    with ZipFile(path, "w", ZIP_DEFLATED, compresslevel=6) as archive:
        for name, rows in snapshot.items():
            if not rows:
                continue
            columns = columns_for(rows, primary_keys[name])
            with archive.open(f"{name}.csv", "w", force_zip64=True) as handle:
                handle.write((",".join(map(csv_cell, columns)) + "\r\n").encode("utf-8"))
                for row in rows:
                    handle.write((",".join(csv_cell(row.get(col)) for col in columns) + "\r\n").encode("utf-8"))


def write_excel(path: Path, snapshot: dict[str, list[dict]], primary_keys: dict) -> None:
    import xlsxwriter

    names = tuple(dict.fromkeys((*FRONT_SHEETS, *snapshot)))
    names = tuple(name for name in names if name in snapshot)
    with xlsxwriter.Workbook(path, {"strings_to_formulas": False, "strings_to_urls": False}) as workbook:
        title = workbook.add_format({"bold": True, "font_size": 23, "font_color": "#153250"})
        subtitle = workbook.add_format({"font_color": "#46596B"})
        header = workbook.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": "#225782", "text_wrap": True, "valign": "vcenter"})
        linked = workbook.add_format({"font_color": "#185A94", "underline": True})
        number = workbook.add_format({"num_format": "#,##0.###"})
        money = workbook.add_format({"num_format": '"CHF " #,##0.00'})
        day = workbook.add_format({"num_format": "dd.mm.yyyy"})
        timestamp = workbook.add_format({"num_format": "dd.mm.yyyy hh:mm"})
        wrap = workbook.add_format({"text_wrap": True, "valign": "top"})
        index = workbook.add_worksheet("Übersicht")
        index.hide_gridlines(2)
        index.set_tab_color("#E47A27")
        index.set_column("A:A", 30)
        index.set_column("B:B", 32)
        index.set_column("C:C", 16)
        index.set_row(0, 35)
        index.merge_range("A1:C1", "ITAssetFlow · Datenexport", title)
        index.merge_range("A2:C2", f"Stand: {datetime.now(timezone.utc):%d.%m.%Y %H:%M} UTC", subtitle)
        index.merge_range("A3:C3", "Zeitangaben: UTC · Blattname anklicken, um zur Tabelle zu wechseln.", subtitle)
        index.freeze_panes(5, 0)
        overflow = None
        overflow_row = 1
        index_rows = []
        sheets = {name: workbook.add_worksheet(SHEET_NAMES[name]) for name in names}
        for name in names:
            rows = snapshot[name]
            if len(rows) > XLSX_MAX_ROWS - 4:
                raise ValueError("Mindestens eine Tabelle überschreitet das Zeilenlimit von Excel. Verwende den CSV-Export.")
            label = SHEET_NAMES[name]
            index_rows.append((label, name, len(rows)))
            sheet = sheets[name]
            sheet.hide_gridlines(2)
            sheet.set_tab_color("#2868A4" if name in FRONT_SHEETS else "#9DADB9")
            sheet.set_row(0, 32)
            sheet.set_row(3, 32)
            sheet.freeze_panes(4, 1)
            sheet.merge_range("A1:D1", label, title)
            sheet.write_url("A2", "internal:'Übersicht'!A1", linked, "← Übersicht")
            sheet.merge_range("B2:D2", f"{name} · {len(rows):,} Datensätze", subtitle)
            columns = columns_for(rows, primary_keys[name])
            if name in ("assets", "inventory_stock_levels"):
                leading = ("asset_tag", "product_model_name", "site_name", "storage_location_name",
                           "condition", "stock_quantity", "quantity", "new_price")
                columns = [col for col in leading if col in columns] + [col for col in columns if col not in leading]
            labels = {col: HEADER_LABELS.get(col, col.replace("_", " ").capitalize()) for col in columns}
            for col, label in tuple(labels.items()):
                if list(labels.values()).count(label) > 1:
                    labels[col] = col
            for pos, column in enumerate(columns):
                sample = (row.get(column) for row in rows[:150])
                width = max((min(len(serialized_value(value)), 48) for value in sample if value is not None), default=0)
                sheet.set_column(pos, pos, min(52, max(12, len(labels[column]) + 4, width + 2)))
            if not rows:
                sheet.write("A4", "Keine Datensätze", subtitle)
                continue
            sheet.add_table(3, 0, 3 + len(rows), len(columns) - 1, {
                "style": "Table Style Medium 2",
                "columns": [{"header": labels[col], "header_format": header} for col in columns],
            })
            for row_index, row in enumerate(rows, 4):
                for column_index, column in enumerate(columns):
                    value = row.get(column)
                    if value is None:
                        continue
                    if isinstance(value, bool):
                        sheet.write_boolean(row_index, column_index, value)
                        continue
                    if isinstance(value, (int, float, Decimal)) and not (isinstance(value, int) and abs(value) >= 10**15):
                        sheet.write_number(row_index, column_index, value, money if column == "new_price" else number)
                        continue
                    value_text = serialized_value(value)
                    if isinstance(value, (str, date, datetime)) and (column.endswith(("_at", "_date", "_until", "_from", "_to"))):
                        try:
                            parsed = datetime.fromisoformat(value_text.replace("Z", "+00:00"))
                            if parsed.year >= 1900:
                                local = parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
                                sheet.write_datetime(row_index, column_index, local, day if len(value_text) == 10 else timestamp)
                                continue
                        except ValueError:
                            pass
                    if len(value_text) > CHUNK_LENGTH:
                        if overflow is None:
                            overflow = workbook.add_worksheet("Lange Werte")
                            overflow.hide_gridlines(2)
                            overflow.freeze_panes(1, 0)
                            overflow.set_column("A:B", 23)
                            overflow.set_column("C:D", 10)
                            overflow.set_column("E:E", 72)
                            overflow.write_row(0, 0, ("Tabelle", "Spalte", "Excel-Zeile", "Teil", "Wert"), header)
                        sheet.write_url(row_index, column_index, f"internal:'Lange Werte'!E{overflow_row + 1}", linked, "Langen Wert öffnen")
                        for start in range(0, len(value_text), CHUNK_LENGTH):
                            if overflow_row >= XLSX_MAX_ROWS:
                                raise ValueError("Lange Datenwerte überschreiten das Zeilenlimit von Excel. Verwende den CSV-Export.")
                            overflow.write_row(overflow_row, 0, (name, column, row_index + 1, start // CHUNK_LENGTH + 1))
                            overflow.write_string(overflow_row, 4, value_text[start:start + CHUNK_LENGTH])
                            overflow_row += 1
                        continue
                    sheet.write_string(row_index, column_index, value_text, wrap if "\n" in value_text else None)
        if overflow is not None:
            overflow.autofilter(0, 0, overflow_row - 1, 4)
        if index_rows:
            index.add_table(4, 0, 4 + len(index_rows), 2, {
                "style": "Table Style Medium 2",
                "columns": [{"header": col, "header_format": header} for col in ("Blatt", "Datenbanktabelle", "Datensätze")],
            })
            for row_index, (label, name, row_count) in enumerate(index_rows, 5):
                index.write_url(row_index, 0, f"internal:'{label}'!A1", linked, label)
                index.write(row_index, 1, name)
                index.write_number(row_index, 2, row_count, number)
