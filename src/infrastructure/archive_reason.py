"""Gemeinsame Pflichtangaben für Archivierungen und Teilentnahmen."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ArchiveReason(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: Literal["customer", "defective", "retired", "lost", "other"]
    customer_name: str | None = Field(default=None, max_length=200)
    destroyed: bool | None = None
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def required_details(self):
        if self.reason == "customer" and not self.customer_name:
            raise ValueError("Bitte den Kundennamen eingeben.")
        if self.reason == "defective" and self.destroyed is None:
            raise ValueError("Bitte angeben, ob der Artikel vernichtet wurde.")
        if self.reason == "other" and not self.note:
            raise ValueError("Bitte einen Löschgrund eingeben.")
        return self

