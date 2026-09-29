import { useId } from "react";
import { purchaseDateError } from "../utils/purchaseDateFilter";
import type { PurchaseDateCriteria } from "../utils/purchaseDateFilter";
import "./PurchaseDateFilter.css";

type Props = {
  value: PurchaseDateCriteria;
  disabled: boolean;
  onChange: (value: PurchaseDateCriteria) => void;
};

const DATE_FIELDS = [
  { key: "from", label: "Von" },
  { key: "to", label: "Bis" },
] as const;

export default function PurchaseDateFilter({ value, disabled, onChange }: Props) {
  const errorId = useId();
  const error = purchaseDateError(value);

  return (
    <fieldset className="purchase-date-filter" disabled={disabled} aria-label="Kaufdatum">
      {DATE_FIELDS.map(({ key, label }) => (
        <div className="purchase-date-field" key={key}>
          <input
            className={value[key] ? "" : "purchase-date-empty"}
            type="date"
            lang="de-CH"
            aria-label={`Kaufdatum ${label.toLocaleLowerCase("de-CH")}`}
            value={value[key]}
            min={key === "to" ? value.from || undefined : undefined}
            max={key === "from" ? value.to || "9999-12-31" : "9999-12-31"}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          />
          {!value[key] && (
            <span className="purchase-date-placeholder" aria-hidden="true">{label}</span>
          )}
        </div>
      ))}
      {error && <p id={errorId} className="purchase-date-error" role="status">{error}</p>}
    </fieldset>
  );
}
