import { useState, type Dispatch, type SetStateAction } from "react";

export type EmployeeRow = {
  id: string | number | null | undefined;
  client_key: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string;
  department_ref: string | null;
  is_active: boolean;
  auth_user_id: string | null;
  app_role: "admin" | "user" | "viewer";
  allowed_site_refs: string[];
};

type Props = {
  employees: EmployeeRow[];
  sites: { client_key: string; name: string }[];
  departments: { client_key: string; name: string; site_ref: string | null }[];
  saving: boolean;
  email: string;
  setEmployees: Dispatch<SetStateAction<EmployeeRow[]>>;
  nextKey: () => string;
  onDelete: (employee: EmployeeRow) => void;
  onMessage: (message: string) => void;
};

export default function EmployeesSettings({
  employees, sites, departments, saving, email, setEmployees, nextKey, onDelete, onMessage,
}: Props) {
  const [siteFilter, setSiteFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const departmentByKey = new Map(departments.map((row) => [row.client_key, row]));
  const siteByKey = new Map(sites.map((row) => [row.client_key, row]));
  const name = (row: EmployeeRow) => `${row.first_name} ${row.last_name}`.trim();
  const selected = employees.find((row) => row.client_key === selectedKey);
  const visible = employees.filter((row) => {
    const department = departmentByKey.get(row.department_ref ?? "");
    return (!siteFilter || department?.site_ref === siteFilter)
      && (!departmentFilter || row.department_ref === departmentFilter)
      && (showInactive || row.is_active)
      && (!search.trim() || `${name(row)} ${row.email} ${row.employee_number}`
        .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  }).sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(
    `${b.last_name} ${b.first_name}`, "de-CH", { sensitivity: "base" },
  ));
  const selectedVisible = visible.some((row) => row.client_key === selectedKey);

  function update(key: string, changes: Partial<EmployeeRow>) {
    setEmployees((current) => current.map((row) => row.client_key === key ? { ...row, ...changes } : row));
  }

  function add() {
    const departmentRef = departmentFilter || departments.find(
      (row) => siteFilter && row.site_ref === siteFilter,
    )?.client_key || null;
    if (siteFilter && !departmentRef) {
      onMessage("Bitte für diesen Standort zuerst unter Struktur eine Abteilung anlegen.");
      return;
    }
    const key = nextKey();
    setEmployees((current) => [...current, {
      id: null, client_key: key, employee_number: "", first_name: "", last_name: "", email: "",
      department_ref: departmentRef, is_active: true, auth_user_id: null, app_role: "viewer", allowed_site_refs: [],
    }]);
    setSearch("");
    setSelectedKey(key);
    setEditingKey(key);
    onMessage("Mitarbeiter angelegt. Vorname und Nachname ausfüllen und mit „Übernehmen“ speichern.");
  }

  function field(row: EmployeeRow, key: "first_name" | "last_name" | "email" | "employee_number", label: string) {
    if (editingKey !== row.client_key || (key === "email" && row.auth_user_id)) {
      return <span className="settings-cell-text">{row[key] || "—"}</span>;
    }
    return <input
      className="settings-cell-editor"
      aria-label={key === "email" ? "E-Mail (optional)" : label}
      type={key === "email" ? "email" : "text"}
      value={row[key]}
      disabled={saving}
      autoFocus={key === "first_name"}
      placeholder={key === "email" ? "Optional" : undefined}
      onChange={(event) => update(row.client_key, { [key]: event.target.value })}
    />;
  }

  return (
    <div className="settings-single-page settings-employees-page">
      <header className="settings-page-intro">
        <h2>Mitarbeiter</h2>
        <p>Mitarbeiter erfassen und einer Abteilung zuordnen. Der Standort ergibt sich aus der Abteilung.</p>
      </header>
      <div className="settings-employee-filters">
        <label>Standort
          <select aria-label="Mitarbeiter nach Standort filtern" value={siteFilter} disabled={saving}
            onChange={(event) => { setSiteFilter(event.target.value); setDepartmentFilter(""); setSelectedKey(null); }}>
            <option value="">Alle Standorte</option>
            {sites.map((row) => <option key={row.client_key} value={row.client_key}>{row.name}</option>)}
          </select>
        </label>
        <label>Abteilung
          <select aria-label="Mitarbeiter nach Abteilung filtern" value={departmentFilter} disabled={saving}
            onChange={(event) => { setDepartmentFilter(event.target.value); setSelectedKey(null); }}>
            <option value="">Alle Abteilungen</option>
            {departments.filter((row) => !siteFilter || row.site_ref === siteFilter).map((row) =>
              <option key={row.client_key} value={row.client_key}>
                {siteByKey.get(row.site_ref ?? "")?.name ?? "Ohne Standort"} · {row.name}
              </option>,
            )}
          </select>
        </label>
        <label>Suche
          <input type="search" aria-label="Mitarbeiter suchen" placeholder="Name, E-Mail oder Personalnummer"
            value={search} disabled={saving} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label className="settings-employee-checkbox">
          <input type="checkbox" checked={showInactive} disabled={saving}
            onChange={(event) => setShowInactive(event.target.checked)} /> Inaktive anzeigen
        </label>
      </div>
      <div className="settings-actions settings-actions-left">
        <button type="button" disabled={saving} onClick={add}>Mitarbeiter hinzufügen</button>
        <button type="button" disabled={saving || !selectedVisible} onClick={() =>
          setEditingKey(editingKey === selectedKey ? null : selectedKey)}>
          {editingKey && editingKey === selectedKey ? "Bearbeitung beenden" : "Bearbeiten"}
        </button>
        <button type="button" disabled={saving || !selectedVisible || Boolean(selected?.auth_user_id)}
          title={selected?.auth_user_id ? "Verknüpfte Benutzerkonten können hier nicht gelöscht werden." : undefined}
          onClick={() => {
            if (!selected || !window.confirm(`Mitarbeiter „${name(selected) || "ohne Name"}“ wirklich löschen?`)) return;
            onDelete(selected);
            setSelectedKey(null);
            setEditingKey(null);
          }}>Löschen</button>
        <span className="settings-employee-count">{visible.length} von {employees.length} Mitarbeitern</span>
      </div>
      <div className="settings-table-wrap settings-table-grow">
        <table className="settings-table settings-employees-table" aria-label="Mitarbeiter">
          <thead><tr>
            <th>Vorname</th><th>Nachname</th><th>E-Mail (optional)</th><th>Personalnr.</th>
            <th>Standort</th><th>Abteilung</th><th>Aktiv</th>
          </tr></thead>
          <tbody>
            {visible.map((row) => {
              const department = departmentByKey.get(row.department_ref ?? "");
              const editing = editingKey === row.client_key;
              const ownAccount = Boolean(row.auth_user_id) && row.email.toLocaleLowerCase() === email.toLocaleLowerCase();
              return <tr key={row.client_key}
                className={[selectedKey === row.client_key ? "selected" : "", editing ? "editing" : ""].join(" ")}
                tabIndex={0} aria-selected={selectedKey === row.client_key}
                onClick={() => setSelectedKey(row.client_key)}
                onDoubleClick={() => !saving && setEditingKey(row.client_key)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                  event.preventDefault();
                  setSelectedKey(row.client_key);
                  if (event.key === "Enter" && !saving) setEditingKey(row.client_key);
                }}>
                <td>{field(row, "first_name", "Vorname")}</td>
                <td>{field(row, "last_name", "Nachname")}</td>
                <td title={row.auth_user_id ? "Die Anmelde-E-Mail wird über die Benutzerverwaltung gepflegt." : undefined}>
                  {field(row, "email", "E-Mail")}
                </td>
                <td>{field(row, "employee_number", "Personalnummer")}</td>
                <td><span className="settings-cell-text">{siteByKey.get(department?.site_ref ?? "")?.name || "Nicht zugeordnet"}</span></td>
                <td>{editing ? <select className="settings-cell-editor" aria-label={`Abteilung für ${name(row) || "neuen Mitarbeiter"}`}
                  value={row.department_ref ?? ""} disabled={saving}
                  onChange={(event) => update(row.client_key, { department_ref: event.target.value || null })}>
                  <option value="">Nicht zugeordnet</option>
                  {departments.map((item) => <option key={item.client_key} value={item.client_key}>
                    {siteByKey.get(item.site_ref ?? "")?.name || "Ohne Standort"} · {item.name}
                  </option>)}
                </select> : <span className="settings-cell-text">{department?.name || "Nicht zugeordnet"}</span>}</td>
                <td className="settings-employee-active"><input type="checkbox"
                  aria-label={`Aktiv: ${name(row) || "neuer Mitarbeiter"}`} checked={row.is_active}
                  disabled={saving || !editing || ownAccount}
                  title={ownAccount ? "Das eigene Benutzerkonto kann hier nicht deaktiviert werden." : undefined}
                  onChange={(event) => update(row.client_key, { is_active: event.target.checked })} /></td>
              </tr>;
            })}
            {visible.length === 0 && <tr><td colSpan={7} className="settings-empty-state">Keine Mitarbeiter gefunden.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="settings-employee-note">Eine E-Mail-Adresse ist optional. Neue Mitarbeiter erhalten hier keinen Anmeldezugang. Bereits verwendete Mitarbeiter können deaktiviert werden, damit Zuordnungen erhalten bleiben.</p>
    </div>
  );
}
