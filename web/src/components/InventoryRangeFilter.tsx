import { useId, useState } from "react";

type Props = {
  label: string;
  value: string;
  error: string;
  onChange: (value: string) => void;
};

export default function InventoryRangeFilter({ label, value, error, onChange }: Props) {
  const errorId = useId();
  const [showError, setShowError] = useState(false);
  const invalid = showError && Boolean(error);
  return (
    <div className="sidebar-range-filter">
      <input
        type="text"
        aria-label={label}
        placeholder={label}
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setShowError(false)}
        onBlur={() => setShowError(true)}
        onKeyDown={event => { if (event.key === "Enter") setShowError(true); }}
      />
      {invalid && <p id={errorId} className="sidebar-range-error" role="status">{error}</p>}
    </div>
  );
}
