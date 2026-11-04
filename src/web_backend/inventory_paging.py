"""Return inventory pages after applying filters to the full scoped result."""
from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime
from hashlib import sha256
import json
import math
import re
from threading import Lock
from time import monotonic
from typing import Annotated, Literal
from unicodedata import normalize
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from infrastructure.scanner_codes import normalize_mac
from inventory import CONDITION_LABELS, INVENTORY_GROUP_LABELS, PREFERRED_COLUMN_ORDER, STATUS_LABELS

FILTERS = {
    "groups": ("_web_inventory_group", INVENTORY_GROUP_LABELS),
    "categories": ("_web_category_key", None),
    "conditions": ("_web_condition_key", CONDITION_LABELS),
    "statuses": ("status", STATUS_LABELS),
    "sites": ("site_name", None),
    "departments": ("department_name", None),
    "storageLocations": ("storage_location", None),
}
SEARCH_FIELDS = tuple(dict.fromkeys((*PREFERRED_COLUMN_ORDER, "asset_tag", "serial_number",
    "mac_address", "qr_code", "ean", "product_model_qr_code", "product_model_ean",
    "product_model_sku", "product_model_part_number")))
DATETIME_FIELDS = {"created_at", "updated_at", "archived_at"}
try:
    ZURICH = ZoneInfo("Europe/Zurich")
except ZoneInfoNotFoundError:
    ZURICH = None

FilterValue = Annotated[str, Field(max_length=300)]
Price = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class InventoryQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    search: str = Field(default="", max_length=400)
    filters: dict[str, Annotated[list[FilterValue], Field(max_length=250)]] = Field(default_factory=dict, max_length=7)
    date_from: date | None = None
    date_to: date | None = None
    price_from: Price | None = None
    price_to: Price | None = None
    sort: Literal["asc", "desc"] = "asc"
    column: str | None = Field(default=None, max_length=100)

    @field_validator("column")
    @classmethod
    def known_column(cls, value):
        if value is not None and value not in PREFERRED_COLUMN_ORDER:
            raise ValueError("Ungültige Sortierspalte.")
        return value

    @field_validator("filters")
    @classmethod
    def known_filters(cls, value):
        if value.keys() - FILTERS.keys():
            raise ValueError("Ungültiger Inventarfilter.")
        return value


class InventoryPageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: InventoryQuery = Field(default_factory=InventoryQuery)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=200)
    snapshot: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    refresh: bool = False


def text_key(value) -> str:
    return str(value if value is not None else "").strip().lower()


def _number(value) -> float | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError, OverflowError):
        return None


def _date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _datetime(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _search_value(key: str, value) -> str:
    if value is None:
        return ""
    if key in DATETIME_FIELDS:
        parsed = _datetime(value)
        if parsed:
            if parsed.tzinfo is not None and ZURICH:
                parsed = parsed.astimezone(ZURICH)
            return f"{value} {parsed:%d.%m.%Y-%H-%M}"
    if key in ("status", "condition"):
        labels = STATUS_LABELS if key == "status" else CONDITION_LABELS
        return str(labels.get(text_key(value), value)) + " " + str(value)
    if isinstance(value, bool):
        return "Ja" if value else "Nein"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
    return str(value)


def _natural(value: str) -> tuple:
    plain = "".join(ch for ch in normalize("NFKD", value.casefold()) if not 0x0300 <= ord(ch) <= 0x036F)
    return tuple((0, int(part)) if part.isdecimal() and len(part) <= 200 else (1, part)
                 for part in re.split(r"(\d+)", plain))


def _sort_key(value, column: str) -> tuple:
    if column in DATETIME_FIELDS:
        parsed = _datetime(value)
        if parsed is not None:
            return (0, parsed.timestamp())
    number = _number(value) if column in ("new_price", "stock_quantity") else None
    return (0, number) if number is not None else (1, _natural(text_key(value)))


def options_for(rows: list[dict]) -> dict:
    result = {}
    for name, (field, labels) in FILTERS.items():
        values = {}
        for row in rows:
            key = text_key(row.get(field))
            if key:
                label = row.get("product_category_name") if name == "categories" else row.get(field)
                values[key] = labels.get(key, label or key) if labels else str(label or key).strip()
        result[name] = [{"key": key, "label": label} for key, label in
                        sorted(values.items(), key=lambda item: _natural(item[1]))]
    return result


def _mac(value) -> str | None:
    try:
        return normalize_mac(value)
    except ValueError:
        return None


def filtered(rows: list[dict], query: InventoryQuery) -> list[dict]:
    criteria = [(FILTERS[key][0], set(map(text_key, values))) for key, values in query.filters.items() if values]
    search = text_key(query.search)
    mac = _mac(search)
    by_price = query.price_from is not None or query.price_to is not None
    by_date = query.date_from is not None or query.date_to is not None
    if query.date_from and query.date_to and query.date_from > query.date_to:
        return []

    def matches(row: dict) -> bool:
        if any(text_key(row.get(field)) not in values for field, values in criteria):
            return False
        if by_price:
            amount = _number(row.get("new_price"))
            if amount is None or (query.price_from is not None and amount < query.price_from) or (
                    query.price_to is not None and amount > query.price_to):
                return False
        if by_date:
            day = _date(row.get("purchase_date"))
            if day is None or (query.date_from and day < query.date_from) or (query.date_to and day > query.date_to):
                return False
        if not search:
            return True
        if mac and any(_mac(row.get(field)) == mac for field in ("mac_address", "asset_tag")):
            return True
        return any(search in _search_value(field, row.get(field)).lower() for field in SEARCH_FIELDS if row.get(field) is not None)

    result = [row for row in rows if matches(row)]
    column = query.column
    if column:
        present = [row for row in result if row.get(column) not in (None, "")]
        absent = [row for row in result if row.get(column) in (None, "")]
        present.sort(key=lambda row: _sort_key(row[column], column), reverse=query.sort == "desc")
        return present + absent
    return result


def page_token(identity: str, revision: int, query: InventoryQuery) -> str:
    return sha256(f"{identity}:{revision}:{query.model_dump_json()}".encode()).hexdigest()


class InventorySnapshots:
    """A small process-local cache keyed by verified session and DB revision."""
    MAX_BYTES = 32 * 1024 * 1024
    TTL = 45

    def __init__(self):
        self._items: OrderedDict[tuple[str, int], tuple[float, int, list[dict]]] = OrderedDict()
        self._size = 0
        self._lock = Lock()

    def _remove(self, key):
        self._size -= self._items.pop(key)[1]

    def get(self, identity: str, revision: int):
        key = (identity, revision)
        with self._lock:
            now = monotonic()
            for previous, (expires, _, _) in list(self._items.items()):
                if expires <= now or (previous[0] == identity and previous[1] != revision):
                    self._remove(previous)
            item = self._items.get(key)
            if item is None:
                return None
            self._items.move_to_end(key)
            return item[2]

    def put(self, identity: str, revision: int, rows: list[dict]):
        # Approximate memory including dictionary overhead; limit both rows and bytes.
        if len(rows) > 50_000:
            return
        size = sum(256 + 2 * len(json.dumps(row, default=str, ensure_ascii=False)) for row in rows)
        if size > self.MAX_BYTES // 2:
            return
        key = (identity, revision)
        with self._lock:
            if key in self._items:
                self._remove(key)
            while self._items and (len(self._items) >= 16 or self._size + size > self.MAX_BYTES):
                self._remove(next(iter(self._items)))
            self._items[key] = (monotonic() + self.TTL, size, rows)
            self._size += size
