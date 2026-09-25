import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import type { KeyboardEvent } from "react";
import ProductModelsPage from "./ProductModelsPage";
import type { ProductModelsHandle } from "./ProductModelsPage";
import "./SettingsPage.css";


const API_BASE =
  import.meta.env.VITE_API_BASE_URL
  ?? `${window.location.protocol}//${window.location.hostname}:8000`;


const LOCATION_TYPES = {
  warehouse: "Lager",
  area: "Bereich",
  room: "Raum",
} as const;


const SPEC_TYPES = {
  text: "Text",
  integer: "Ganzzahl",
  number: "Zahl",
  boolean: "Ja / Nein",
} as const;


const SPEC_SCOPES = {
  model: "Produktmodell",
  asset: "Einzelartikel",
} as const;


const FALLBACK_GROUP_LABELS: Record<string, string> = {
  device: "Gerät",
  peripheral: "Peripherie",
  component: "Komponente",
  consumable: "Verbrauchsmaterial",
  other: "Sonstiges",
};


type RowId = string | number | null | undefined;

type MessageTone =
  | "info"
  | "success"
  | "warning"
  | "error";


type SettingsTab =
  | "structure"
  | "categories"
  | "product-models"
  | "specifications"
  | "manufacturers"
  | "permissions"
  | "columns";


const SETTINGS_TABS: Array<[SettingsTab, string]> = [
  ["structure", "Struktur"],
  ["categories", "Kategorien"],
  ["product-models", "Produktmodelle"],
  ["specifications", "Spezifikationen"],
  ["manufacturers", "Hersteller"],
  ["permissions", "Berechtigungen"],
  ["columns", "Standardspalten"],
];


type DeleteKey =
  | "sites"
  | "departments"
  | "storage_locations"
  | "employees"
  | "product_categories"
  | "manufacturers";


type SiteRow = {
  id: RowId;
  client_key: string;
  name: string;
  street: string;
  street_number: string;
  postal_code: string;
  city: string;
  country: string;
  organization_id: unknown;
};


type DepartmentRow = {
  id: RowId;
  client_key: string;
  name: string;
  organization_id: unknown;
  site_ref: string | null;
};


type LocationRow = {
  id: RowId;
  client_key: string;
  name: string;
  department_ref: string | null;
  parent_location_id: unknown;
  code: unknown;
  location_type: keyof typeof LOCATION_TYPES;
  is_active: boolean;
};


type SpecificationField = {
  key: string;
  label: string;
  type: keyof typeof SPEC_TYPES;
  unit: string;
  scope: keyof typeof SPEC_SCOPES;
};


type CategoryRow = {
  id: RowId;
  client_key: string;
  name: string;
  code: string;
  inventory_group: string;
  specification_schema: {
    fields: SpecificationField[];
  };
};


type ManufacturerRow = {
  id: RowId;
  client_key: string;
  name: string;
};


type AppRole =
  | "admin"
  | "user"
  | "viewer";


type EmployeeRow = {
  id: RowId;
  client_key: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string;
  department_ref: string | null;
  is_active: boolean;
  auth_user_id: string | null;
  app_role: AppRole;
};


type SettingsResponse = {
  sites: Array<Record<string, unknown>>;
  departments: Array<Record<string, unknown>>;
  storage_locations: Array<Record<string, unknown>>;
  product_categories: Array<Record<string, unknown>>;
  manufacturers: Array<Record<string, unknown>>;
  employees: Array<Record<string, unknown>>;
  column_order: string[];
  headers: Record<string, string>;
  factory_default_visible_columns: string[];
  inventory_group_labels: Record<string, string>;
};


type SettingsPageProps = {
  email: string;
  onSessionExpired: () => void;
};


type DeletedState = Record<DeleteKey, unknown[]>;


function emptyDeleted(): DeletedState {
  return {
    sites: [],
    departments: [],
    storage_locations: [],
    employees: [],
    product_categories: [],
    manufacturers: [],
  };
}


function idRef(value: RowId): string | null {
  if (
    value === null
    || value === undefined
    || String(value).trim() === ""
  ) {
    return null;
  }

  return `id:${String(value)}`;
}


function text(value: unknown): string {
  return String(
    value ?? "",
  ).trim();
}


function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
  );
}


function technicalKey(
  value: string,
  fallback: string,
): string {
  const replacements: Record<string, string> = {
    ä: "ae",
    ö: "oe",
    ü: "ue",
    ß: "ss",
  };

  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(
      /[äöüß]/g,
      (character) =>
        replacements[character] ?? character,
    )
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .replace(
      /[^a-z0-9]+/g,
      "_",
    )
    .replace(
      /^_+|_+$/g,
      "",
    );

  return normalized || fallback;
}


function uniqueTechnicalKey(
  value: string,
  used: Set<string>,
  fallback: string,
): string {
  const base =
    technicalKey(
      value,
      fallback,
    );

  let candidate = base;
  let number = 2;

  while (
    used.has(
      candidate.toLocaleLowerCase(),
    )
  ) {
    candidate = `${base}_${number}`;
    number += 1;
  }

  used.add(
    candidate.toLocaleLowerCase(),
  );

  return candidate;
}


function settingsStorageKey(
  email: string,
): string {
  return (
    "itassetflow.default_visible_columns:"
    + email.trim().toLocaleLowerCase()
  );
}


function readStoredColumns(
  email: string,
  available: string[],
  factoryDefaults: string[],
): string[] {
  try {
    const raw = localStorage.getItem(
      settingsStorageKey(email),
    );

    if (raw) {
      const parsed: unknown =
        JSON.parse(raw);

      if (Array.isArray(parsed)) {
        const selected = parsed
          .filter(
            (value): value is string =>
              typeof value === "string",
          )
          .filter(
            (column) =>
              available.includes(column),
          );

        if (selected.length > 0) {
          return [
            ...new Set(selected),
          ];
        }
      }
    }
  } catch {
    // Ungültige lokale Einstellung -> Werkseinstellung verwenden.
  }

  const defaults = factoryDefaults
    .filter(
      (column) =>
        available.includes(column),
    );

  return defaults.length > 0
    ? defaults
    : available.slice(0, 5);
}


function normalizeSpecField(
  raw: unknown,
): SpecificationField | null {
  if (!isRecord(raw)) {
    return null;
  }

  const rawType =
    text(raw.type).toLocaleLowerCase();

  const rawScope =
    text(raw.scope).toLocaleLowerCase();

  const type = (
    rawType in SPEC_TYPES
      ? rawType
      : "text"
  ) as keyof typeof SPEC_TYPES;

  const scope = (
    rawScope in SPEC_SCOPES
      ? rawScope
      : "model"
  ) as keyof typeof SPEC_SCOPES;

  return {
    key: text(raw.key),
    label: text(raw.label),
    type,
    unit: text(raw.unit),
    scope,
  };
}


function normalizeResponse(
  raw: unknown,
): SettingsResponse {
  if (!isRecord(raw)) {
    throw new Error(
      "Der Webserver hat ungültige Einstellungsdaten zurückgegeben.",
    );
  }

  const data: Record<string, unknown> = raw;

  function rows(
    key: string,
  ): Array<Record<string, unknown>> {
    const value = data[key];

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(isRecord);
  }

  const columnOrder = Array.isArray(
    data.column_order,
  )
    ? data.column_order.filter(
        (value): value is string =>
          typeof value === "string",
      )
    : [];

  const factoryDefaults = Array.isArray(
    data.factory_default_visible_columns,
  )
    ? data.factory_default_visible_columns.filter(
        (value): value is string =>
          typeof value === "string",
      )
    : [];

  return {
    sites: rows("sites"),
    departments: rows("departments"),
    storage_locations: rows("storage_locations"),
    product_categories: rows("product_categories"),
    manufacturers: rows("manufacturers"),
    employees: rows("employees"),
    column_order: columnOrder,
    headers: isRecord(data.headers)
      ? Object.fromEntries(
          Object.entries(data.headers)
            .map(
              ([key, value]) => [
                key,
                String(value ?? key),
              ],
            ),
        )
      : {},
    factory_default_visible_columns: factoryDefaults,
    inventory_group_labels: isRecord(
      data.inventory_group_labels,
    )
      ? Object.fromEntries(
          Object.entries(
            data.inventory_group_labels,
          ).map(
            ([key, value]) => [
              key,
              String(value ?? key),
            ],
          ),
        )
      : FALLBACK_GROUP_LABELS,
  };
}


async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const data: unknown =
      await response.json();

    if (
      isRecord(data)
      && typeof data.detail === "string"
      && data.detail.trim()
    ) {
      return data.detail;
    }
  } catch {
    // Fallback unten verwenden.
  }

  return fallback;
}


function compareLabel(
  left: string,
  right: string,
): number {
  return left.localeCompare(
    right,
    "de-CH",
    {
      sensitivity: "base",
      numeric: true,
    },
  );
}


export default function SettingsPage({
  email,
  onSessionExpired,
}: SettingsPageProps) {
  const navigate =
    useNavigate();

  const counter =
    useRef(0);

  const afterSaveRef =
    useRef(false);

  const [
    reloadSequence,
    setReloadSequence,
  ] = useState(0);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = SETTINGS_TABS.find(([key]) => key === requestedTab)?.[0] ?? "structure";
  const modelEditor = useRef<ProductModelsHandle>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [savedSettings, setSavedSettings] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState(
    "Einstellungen werden geladen ...",
  );

  const [
    messageTone,
    setMessageTone,
  ] = useState<MessageTone>(
    "info",
  );

  const [
    sites,
    setSites,
  ] = useState<SiteRow[]>([]);

  const [
    departments,
    setDepartments,
  ] = useState<DepartmentRow[]>([]);

  const [
    locations,
    setLocations,
  ] = useState<LocationRow[]>([]);

  const [
    categories,
    setCategories,
  ] = useState<CategoryRow[]>([]);

  const [
    manufacturers,
    setManufacturers,
  ] = useState<ManufacturerRow[]>([]);

  const [
    employees,
    setEmployees,
  ] = useState<EmployeeRow[]>([]);

  const [
    deleted,
    setDeleted,
  ] = useState<DeletedState>(
    emptyDeleted,
  );

  const [
    editingRows,
    setEditingRows,
  ] = useState<Set<string>>(
    new Set(),
  );

  const [
    selectedSite,
    setSelectedSite,
  ] = useState<string | null>(null);

  const [
    selectedDepartment,
    setSelectedDepartment,
  ] = useState<string | null>(null);

  const [
    selectedLocation,
    setSelectedLocation,
  ] = useState<string | null>(null);

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState<string | null>(null);

  const [
    selectedManufacturer,
    setSelectedManufacturer,
  ] = useState<string | null>(null);

  const [
    selectedSpecIndex,
    setSelectedSpecIndex,
  ] = useState<number | null>(null);

  const [
    editingSpecIndex,
    setEditingSpecIndex,
  ] = useState<number | null>(null);

  const [
    specCategoryKey,
    setSpecCategoryKey,
  ] = useState<string>("");

  const [
    columnOrder,
    setColumnOrder,
  ] = useState<string[]>([]);

  const [
    headers,
    setHeaders,
  ] = useState<Record<string, string>>({});

  const [
    factoryColumns,
    setFactoryColumns,
  ] = useState<string[]>([]);

  const [
    defaultColumns,
    setDefaultColumns,
  ] = useState<Set<string>>(
    new Set(),
  );

  const [
    groupLabels,
    setGroupLabels,
  ] = useState<Record<string, string>>(
    FALLBACK_GROUP_LABELS,
  );


  const hasSettingsChanges = Boolean(savedSettings && savedSettings !== JSON.stringify([
    sites, departments, locations, categories, manufacturers, employees,
    [...defaultColumns].sort(), deleted,
  ]));

  useEffect(() => {
    if (!hasSettingsChanges && !saving) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [hasSettingsChanges, saving]);

  function changeTab(tab: SettingsTab): boolean {
    if (tab === activeTab) return true;
    if (saving || modelSaving || modelEditor.current?.confirmLeave() === false) return false;
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
    return true;
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = SETTINGS_TABS.length - 1;
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % SETTINGS_TABS.length
      : event.key === "ArrowLeft" ? (index + last) % SETTINGS_TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = SETTINGS_TABS[nextIndex][0];
    if (changeTab(nextTab)) document.getElementById(`settings-tab-${nextTab}`)?.focus();
  }

  function closeSettings(): void {
    if (saving || modelSaving || modelEditor.current?.confirmLeave() === false) return;
    if (hasSettingsChanges && !window.confirm("Nicht gespeicherte Einstellungen verwerfen?")) return;
    navigate("/inventory");
  }

  function editModelSpecifications(categoryId: string): void {
    if (!changeTab("specifications")) return;
    const category = categories.find(row => String(row.id) === categoryId);
    if (category) setSpecCategoryKey(category.client_key);
  }

  function showMessage(
    value: string,
    tone: MessageTone = "info",
  ): void {
    setMessage(value);
    setMessageTone(tone);
  }


  function nextKey(
    prefix: string,
  ): string {
    counter.current += 1;
    return `new:${prefix}:${counter.current}`;
  }


  function startEditing(
    key: string | null,
    label = "Eintrag",
  ): void {
    if (!key) {
      showMessage(
        "Bitte zuerst einen Eintrag auswählen.",
        "warning",
      );
      return;
    }

    setEditingRows(
      (current) => {
        const next =
          new Set(current);

        next.add(key);
        return next;
      },
    );

    showMessage(
      `${label}: Bearbeitungsmodus aktiv. Änderungen werden erst mit „Übernehmen“ gespeichert.`,
      "info",
    );
  }


  function stopEditing(
    key: string,
    label = "Eintrag",
  ): void {
    setEditingRows(
      (current) => {
        const next =
          new Set(current);

        next.delete(key);
        return next;
      },
    );

    showMessage(
      `${label}: Bearbeitung beendet. Noch nicht gespeicherte Änderungen bleiben erhalten.`,
      "warning",
    );
  }


  function toggleEditing(
    key: string | null,
    label: string,
  ): void {
    if (!key) {
      showMessage(
        `Bitte zuerst ${label.toLocaleLowerCase()} auswählen.`,
        "warning",
      );
      return;
    }

    if (editingRows.has(key)) {
      stopEditing(key, label);
    } else {
      startEditing(key, label);
    }
  }


  function rememberDeleted(
    key: DeleteKey,
    id: RowId,
  ): void {
    if (
      id === null
      || id === undefined
      || String(id).trim() === ""
    ) {
      return;
    }

    setDeleted(
      (current) => ({
        ...current,
        [key]: [
          ...current[key],
          id,
        ],
      }),
    );
  }


  useEffect(
    () => {
      let cancelled = false;

      async function load(): Promise<void> {
        setLoading(true);

        if (!afterSaveRef.current) {
          showMessage(
            "Einstellungen werden geladen ...",
            "info",
          );
        }

        try {
          const response = await fetch(
            `${API_BASE}/api/settings`,
            {
              credentials: "include",
            },
          );

          if (response.status === 401) {
            onSessionExpired();
            navigate(
              "/login",
              {
                replace: true,
              },
            );
            return;
          }

          if (!response.ok) {
            throw new Error(
              await responseError(
                response,
                "Einstellungen konnten nicht geladen werden.",
              ),
            );
          }

          const normalized =
            normalizeResponse(
              await response.json(),
            );

          if (cancelled) {
            return;
          }

          const normalizedSites =
            normalized.sites.map(
              (row): SiteRow => ({
                id: row.id as RowId,
                client_key:
                  idRef(row.id as RowId)
                  ?? nextKey("site"),
                name: text(row.name),
                street: text(row.street),
                street_number: text(
                  row.street_number,
                ),
                postal_code: text(
                  row.postal_code,
                ),
                city: text(row.city),
                country: text(row.country),
                organization_id:
                  row.organization_id,
              }),
            );

          const normalizedDepartments =
            normalized.departments.map(
              (row): DepartmentRow => ({
                id: row.id as RowId,
                client_key:
                  idRef(row.id as RowId)
                  ?? nextKey("department"),
                name: text(row.name),
                organization_id:
                  row.organization_id,
                site_ref:
                  idRef(
                    row.site_id as RowId,
                  ),
              }),
            );

          const normalizedLocations =
            normalized.storage_locations.map(
              (row): LocationRow => {
                const rawType =
                  text(row.location_type)
                    .toLocaleLowerCase();

                return {
                  id: row.id as RowId,
                  client_key:
                    idRef(row.id as RowId)
                    ?? nextKey("location"),
                  name: text(row.name),
                  department_ref:
                    idRef(
                      row.department_id as RowId,
                    ),
                  parent_location_id:
                    row.parent_location_id,
                  code: row.code,
                  location_type: (
                    rawType in LOCATION_TYPES
                      ? rawType
                      : "warehouse"
                  ) as keyof typeof LOCATION_TYPES,
                  is_active: true,
                };
              },
            );

          const normalizedCategories =
            normalized.product_categories.map(
              (row): CategoryRow => {
                const schema =
                  isRecord(
                    row.specification_schema,
                  )
                    ? row.specification_schema
                    : {};

                const rawFields =
                  Array.isArray(schema.fields)
                    ? schema.fields
                    : [];

                return {
                  id: row.id as RowId,
                  client_key:
                    idRef(row.id as RowId)
                    ?? nextKey("category"),
                  name: text(row.name),
                  code: text(row.code),
                  inventory_group:
                    text(row.inventory_group)
                    || "other",
                  specification_schema: {
                    fields: rawFields
                      .map(normalizeSpecField)
                      .filter(
                        (
                          field,
                        ): field is SpecificationField =>
                          field !== null,
                      ),
                  },
                };
              },
            );

          const normalizedManufacturers =
            normalized.manufacturers.map(
              (row): ManufacturerRow => ({
                id: row.id as RowId,
                client_key:
                  idRef(row.id as RowId)
                  ?? nextKey("manufacturer"),
                name: text(row.name),
              }),
            );

          const normalizedEmployees =
            normalized.employees.map(
              (row): EmployeeRow => {
                const rawRole =
                  text(
                    row.app_role,
                  ).toLocaleLowerCase();

                const appRole: AppRole =
                  rawRole === "admin"
                  || rawRole === "user"
                  || rawRole === "viewer"
                    ? rawRole
                    : "viewer";

                return {
                  id: row.id as RowId,
                  client_key:
                    idRef(row.id as RowId)
                    ?? nextKey("employee"),
                  employee_number:
                    text(
                      row.employee_number,
                    ),
                  first_name:
                    text(
                      row.first_name,
                    ),
                  last_name:
                    text(
                      row.last_name,
                    ),
                  email:
                    text(
                      row.email,
                    ),
                  department_ref:
                    idRef(
                      row.department_id as RowId,
                    ),
                  is_active:
                    Boolean(
                      row.is_active,
                    ),
                  auth_user_id:
                    text(
                      row.auth_user_id,
                    )
                    || null,
                  app_role:
                    appRole,
                };
              },
            );

          setSites(normalizedSites);
          setDepartments(
            normalizedDepartments,
          );
          setLocations(
            normalizedLocations,
          );
          setCategories(
            normalizedCategories,
          );
          setManufacturers(
            normalizedManufacturers,
          );
          setEmployees(
            normalizedEmployees,
          );
          setDeleted(
            emptyDeleted(),
          );
          setEditingRows(
            new Set(),
          );

          setColumnOrder(
            normalized.column_order,
          );
          setHeaders(
            normalized.headers,
          );
          setFactoryColumns(
            normalized.factory_default_visible_columns,
          );
          setGroupLabels(
            Object.keys(
              normalized.inventory_group_labels,
            ).length > 0
              ? normalized.inventory_group_labels
              : FALLBACK_GROUP_LABELS,
          );

          const storedColumns = readStoredColumns(
            email, normalized.column_order, normalized.factory_default_visible_columns,
          );
          setDefaultColumns(new Set(storedColumns));
          setSavedSettings(JSON.stringify([
            normalizedSites, normalizedDepartments, normalizedLocations, normalizedCategories,
            normalizedManufacturers, normalizedEmployees, [...storedColumns].sort(), emptyDeleted(),
          ]));

          setSpecCategoryKey(
            normalizedCategories[0]
              ?.client_key
            ?? "",
          );

          if (afterSaveRef.current) {
            showMessage(
              "Einstellungen erfolgreich gespeichert.",
              "success",
            );
            afterSaveRef.current = false;
          } else {
            showMessage(
              "Einstellungen bereit.",
              "success",
            );
          }

        } catch (error) {
          if (!cancelled) {
            showMessage(
              error instanceof Error
                ? error.message
                : "Einstellungen konnten nicht geladen werden.",
              "error",
            );
          }

        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      }

      void load();

      return () => {
        cancelled = true;
      };
    },
    [
      email,
      navigate,
      onSessionExpired,
      reloadSequence,
    ],
  );


  const siteByKey =
    useMemo(
      () =>
        new Map(
          sites.map(
            (row) => [
              row.client_key,
              row,
            ],
          ),
        ),
      [sites],
    );


  const departmentByKey =
    useMemo(
      () =>
        new Map(
          departments.map(
            (row) => [
              row.client_key,
              row,
            ],
          ),
        ),
      [departments],
    );


  const sortedSites =
    useMemo(
      () =>
        [...sites].sort(
          (left, right) =>
            compareLabel(
              left.name,
              right.name,
            ),
        ),
      [sites],
    );


  const sortedDepartments =
    useMemo(
      () =>
        [...departments].sort(
          (left, right) =>
            compareLabel(
              left.name,
              right.name,
            ),
        ),
      [departments],
    );


  const currentSpecCategory =
    categories.find(
      (row) =>
        row.client_key
        === specCategoryKey,
    ) ?? null;


  function siteName(
    siteRef: string | null,
  ): string {
    if (!siteRef) {
      return "Nicht zugeordnet";
    }

    return (
      siteByKey.get(siteRef)?.name
      || "Nicht zugeordnet"
    );
  }


  function locationSiteName(
    departmentRef: string | null,
  ): string {
    if (!departmentRef) {
      return "Nicht zugeordnet";
    }

    const department =
      departmentByKey.get(
        departmentRef,
      );

    return siteName(
      department?.site_ref
      ?? null,
    );
  }


  function addSite(): void {
    const clientKey =
      nextKey("site");

    setSites(
      (current) => [
        ...current,
        {
          id: null,
          client_key: clientKey,
          name: "",
          street: "",
          street_number: "",
          postal_code: "",
          city: "",
          country: "",
          organization_id: null,
        },
      ],
    );

    setSelectedSite(clientKey);
    startEditing(clientKey, "Neuer Standort");
  }


  function addDepartment(): void {
    if (sites.length === 0) {
      showMessage(
        "Bitte zuerst einen Standort anlegen.",
        "warning",
      );
      return;
    }

    const clientKey =
      nextKey("department");

    setDepartments(
      (current) => [
        ...current,
        {
          id: null,
          client_key: clientKey,
          name: "",
          organization_id: null,
          site_ref:
            sortedSites[0]
              ?.client_key
            ?? null,
        },
      ],
    );

    setSelectedDepartment(
      clientKey,
    );
    startEditing(clientKey, "Neue Abteilung");
  }


  function addLocation(): void {
    if (departments.length === 0) {
      showMessage(
        "Bitte zuerst eine Abteilung anlegen.",
        "warning",
      );
      return;
    }

    const clientKey =
      nextKey("location");

    setLocations(
      (current) => [
        ...current,
        {
          id: null,
          client_key: clientKey,
          name: "",
          department_ref:
            sortedDepartments[0]
              ?.client_key
            ?? null,
          parent_location_id: null,
          code: null,
          location_type: "warehouse",
          is_active: true,
        },
      ],
    );

    setSelectedLocation(
      clientKey,
    );
    startEditing(clientKey, "Neuer Lagerort");
  }


  function addCategory(): void {
    const clientKey =
      nextKey("category");

    setCategories(
      (current) => [
        ...current,
        {
          id: null,
          client_key: clientKey,
          name: "",
          code: "",
          inventory_group: "other",
          specification_schema: {
            fields: [],
          },
        },
      ],
    );

    setSelectedCategory(
      clientKey,
    );
    setSpecCategoryKey(
      clientKey,
    );
    startEditing(clientKey, "Neue Kategorie");
  }


  function addManufacturer(): void {
    const clientKey =
      nextKey("manufacturer");

    setManufacturers(
      (current) => [
        ...current,
        {
          id: null,
          client_key: clientKey,
          name: "",
        },
      ],
    );

    setSelectedManufacturer(
      clientKey,
    );
    startEditing(clientKey, "Neuer Hersteller");
  }


  function addSpecification(): void {
    if (!currentSpecCategory) {
      showMessage(
        "Bitte zuerst eine Kategorie auswählen.",
        "warning",
      );
      return;
    }

    const nextIndex =
      currentSpecCategory
        .specification_schema
        .fields.length;

    setCategories(
      (current) =>
        current.map(
          (category) =>
            category.client_key
              === currentSpecCategory.client_key
              ? {
                  ...category,
                  specification_schema: {
                    fields: [
                      ...category.specification_schema.fields,
                      {
                        key: "",
                        label: "",
                        type: "text",
                        unit: "",
                        scope: "model",
                      },
                    ],
                  },
                }
              : category,
        ),
    );

    setSelectedSpecIndex(
      nextIndex,
    );
    setEditingSpecIndex(
      nextIndex,
    );

    showMessage(
      "Neue Spezifikation angelegt. Felder ausfüllen und anschließend „Übernehmen“ wählen.",
      "info",
    );
  }


  function deleteSite(): void {
    const row = sites.find(
      (item) =>
        item.client_key
        === selectedSite,
    );

    if (!row) {
      showMessage(
        "Bitte zuerst einen Standort auswählen.",
        "warning",
      );
      return;
    }

    if (
      departments.some(
        (department) =>
          department.site_ref
          === row.client_key,
      )
    ) {
      showMessage(
        "Der Standort wird noch von einer Abteilung verwendet.",
        "warning",
      );
      return;
    }

    if (
      !window.confirm(
        `„${row.name || "Standort"}“ wirklich löschen?`,
      )
    ) {
      return;
    }

    rememberDeleted(
      "sites",
      row.id,
    );

    setSites(
      (current) =>
        current.filter(
          (item) =>
            item.client_key
            !== row.client_key,
        ),
    );

    stopEditing(
      row.client_key,
    );
    setSelectedSite(null);

    showMessage(
      `Standort „${row.name || "ohne Name"}“ zum Löschen vorgemerkt. Mit „Übernehmen“ speichern.`,
      "warning",
    );
  }


  function deleteDepartment(): void {
    const row = departments.find(
      (item) =>
        item.client_key
        === selectedDepartment,
    );

    if (!row) {
      showMessage(
        "Bitte zuerst eine Abteilung auswählen.",
        "warning",
      );
      return;
    }

    if (
      locations.some(
        (location) =>
          location.department_ref
          === row.client_key,
      )
    ) {
      showMessage(
        "Die Abteilung wird noch von einem Lagerort verwendet.",
        "warning",
      );
      return;
    }

    if (
      !window.confirm(
        `„${row.name || "Abteilung"}“ wirklich löschen?`,
      )
    ) {
      return;
    }

    rememberDeleted(
      "departments",
      row.id,
    );

    setDepartments(
      (current) =>
        current.filter(
          (item) =>
            item.client_key
            !== row.client_key,
        ),
    );

    stopEditing(
      row.client_key,
    );
    setSelectedDepartment(null);

    showMessage(
      `Abteilung „${row.name || "ohne Name"}“ zum Löschen vorgemerkt. Mit „Übernehmen“ speichern.`,
      "warning",
    );
  }


  function deleteLocation(): void {
    const row = locations.find(
      (item) =>
        item.client_key
        === selectedLocation,
    );

    if (!row) {
      showMessage(
        "Bitte zuerst einen Lagerort auswählen.",
        "warning",
      );
      return;
    }

    if (
      !window.confirm(
        `„${row.name || "Lagerort"}“ wirklich löschen?`,
      )
    ) {
      return;
    }

    rememberDeleted(
      "storage_locations",
      row.id,
    );

    setLocations(
      (current) =>
        current.filter(
          (item) =>
            item.client_key
            !== row.client_key,
        ),
    );

    stopEditing(
      row.client_key,
    );
    setSelectedLocation(null);

    showMessage(
      `Lagerort „${row.name || "ohne Name"}“ zum Löschen vorgemerkt. Mit „Übernehmen“ speichern.`,
      "warning",
    );
  }


  function deleteCategory(): void {
    const row = categories.find(
      (item) =>
        item.client_key
        === selectedCategory,
    );

    if (!row) {
      showMessage(
        "Bitte zuerst eine Kategorie auswählen.",
        "warning",
      );
      return;
    }

    if (
      !window.confirm(
        `„${row.name || "Kategorie"}“ wirklich löschen?`,
      )
    ) {
      return;
    }

    rememberDeleted(
      "product_categories",
      row.id,
    );

    const remaining =
      categories.filter(
        (item) =>
          item.client_key
          !== row.client_key,
      );

    setCategories(
      remaining,
    );

    stopEditing(
      row.client_key,
    );
    setSelectedCategory(null);

    if (
      specCategoryKey
      === row.client_key
    ) {
      setSpecCategoryKey(
        remaining[0]
          ?.client_key
        ?? "",
      );
      setSelectedSpecIndex(null);
    }

    showMessage(
      `Kategorie „${row.name || "ohne Name"}“ zum Löschen vorgemerkt. Mit „Übernehmen“ speichern.`,
      "warning",
    );
  }


  function deleteManufacturer(): void {
    const row = manufacturers.find(
      (item) =>
        item.client_key
        === selectedManufacturer,
    );

    if (!row) {
      showMessage(
        "Bitte zuerst einen Hersteller auswählen.",
        "warning",
      );
      return;
    }

    if (
      row.id !== null
      && row.id !== undefined
      && row.name.trim().toLocaleLowerCase()
        === "keiner"
    ) {
      showMessage(
        "Der technische Eintrag „Keiner“ kann nicht gelöscht werden.",
        "warning",
      );
      return;
    }

    if (
      !window.confirm(
        `„${row.name || "Hersteller"}“ wirklich löschen?`,
      )
    ) {
      return;
    }

    rememberDeleted(
      "manufacturers",
      row.id,
    );

    setManufacturers(
      (current) =>
        current.filter(
          (item) =>
            item.client_key
            !== row.client_key,
        ),
    );

    stopEditing(
      row.client_key,
    );
    setSelectedManufacturer(null);

    showMessage(
      `Hersteller „${row.name || "ohne Name"}“ zum Löschen vorgemerkt. Mit „Übernehmen“ speichern.`,
      "warning",
    );
  }


  function deleteSpecification(): void {
    if (
      !currentSpecCategory
      || selectedSpecIndex === null
    ) {
      showMessage(
        "Bitte zuerst eine Spezifikation auswählen.",
        "warning",
      );
      return;
    }

    setCategories(
      (current) =>
        current.map(
          (category) => {
            if (
              category.client_key
              !== currentSpecCategory.client_key
            ) {
              return category;
            }

            return {
              ...category,
              specification_schema: {
                fields:
                  category.specification_schema.fields.filter(
                    (_field, index) =>
                      index !== selectedSpecIndex,
                  ),
              },
            };
          },
        ),
    );

    setSelectedSpecIndex(null);
    setEditingSpecIndex(null);

    showMessage(
      "Spezifikation entfernt. Die Änderung wird erst mit „Übernehmen“ gespeichert.",
      "warning",
    );
  }


  function validate(): string[] {
    const errors: string[] = [];

    function validateUniqueNames(
      rows: Array<{
        name: string;
      }>,
      label: string,
    ): void {
      const seen =
        new Set<string>();

      for (const row of rows) {
        const name =
          row.name.trim();

        if (!name) {
          errors.push(
            `${label}: Name fehlt.`,
          );
          continue;
        }

        const key =
          name.toLocaleLowerCase();

        if (seen.has(key)) {
          errors.push(
            `${label} „${name}“ ist doppelt vorhanden.`,
          );
        }

        seen.add(key);
      }
    }


    function validateScopedUniqueNames<T extends {
      name: string;
    }>(
      rows: T[],
      label: string,
      scopeKey: (row: T) => string,
      scopeDescription: (row: T) => string,
    ): void {
      const seen =
        new Set<string>();

      for (const row of rows) {
        const name =
          row.name.trim();

        if (!name) {
          errors.push(
            `${label}: Name fehlt.`,
          );
          continue;
        }

        const key =
          `${scopeKey(row)}\u0000${name.toLocaleLowerCase()}`;

        if (seen.has(key)) {
          errors.push(
            `${label} „${name}“ ist ${scopeDescription(row)} doppelt vorhanden.`,
          );
        }

        seen.add(key);
      }
    }


    validateUniqueNames(
      sites,
      "Standort",
    );

    validateScopedUniqueNames<DepartmentRow>(
      departments,
      "Abteilung",
      (row) =>
        row.site_ref
        ?? "__without_site__",
      (row) =>
        `am Standort „${siteName(row.site_ref)}“`,
    );

    validateScopedUniqueNames<LocationRow>(
      locations,
      "Lagerort",
      (row) =>
        row.department_ref
        ?? "__without_department__",
      (row) => {
        const department =
          departmentByKey.get(
            row.department_ref
            ?? "",
          );

        const departmentName =
          department?.name
          || "Nicht zugeordnet";

        return (
          `in der Abteilung „${departmentName}“ `
          + `am Standort „${siteName(department?.site_ref ?? null)}“`
        );
      },
    );

    validateUniqueNames(
      categories,
      "Kategorie",
    );
    validateUniqueNames(
      manufacturers,
      "Hersteller",
    );

    for (const department of departments) {
      if (
        !department.site_ref
        || !siteByKey.has(
          department.site_ref,
        )
      ) {
        errors.push(
          `Abteilung „${department.name || "ohne Name"}“: Standort fehlt.`,
        );
      }
    }

    for (const location of locations) {
      if (
        !location.department_ref
        || !departmentByKey.has(
          location.department_ref,
        )
      ) {
        errors.push(
          `Lagerort „${location.name || "ohne Name"}“: Abteilung fehlt.`,
        );
      }
    }

    for (const category of categories) {
      const labels =
        new Set<string>();

      for (
        const field
        of category.specification_schema.fields
      ) {
        const label =
          field.label.trim();

        if (!label) {
          errors.push(
            `Kategorie „${category.name || "ohne Name"}“: Bezeichnung einer Spezifikation fehlt.`,
          );
          continue;
        }

        const key =
          label.toLocaleLowerCase();

        if (labels.has(key)) {
          errors.push(
            `Kategorie „${category.name}“: Spezifikation „${label}“ ist doppelt vorhanden.`,
          );
        }

        labels.add(key);
      }
    }

    if (defaultColumns.size === 0) {
      errors.push(
        "Standardspalten: Mindestens eine Spalte muss ausgewählt sein.",
      );
    }

    return errors;
  }


  function buildPayload(): Record<string, unknown> {
    const usedCategoryCodes =
      new Set<string>(
        categories
          .map(
            (category) =>
              category.code
                .trim()
                .toLocaleLowerCase(),
          )
          .filter(Boolean),
      );

    const categoryPayload =
      categories.map(
        (category) => {
          const code =
            category.code.trim()
            || uniqueTechnicalKey(
              category.name,
              usedCategoryCodes,
              "category",
            );

          const usedSpecKeys =
            new Set<string>(
              category.specification_schema.fields
                .map(
                  (field) =>
                    field.key
                      .trim()
                      .toLocaleLowerCase(),
                )
                .filter(Boolean),
            );

          const fields =
            category.specification_schema.fields.map(
              (field) => ({
                key:
                  field.key.trim()
                  || uniqueTechnicalKey(
                    field.label,
                    usedSpecKeys,
                    "specification",
                  ),
                label: field.label.trim(),
                type: field.type,
                unit:
                  field.unit.trim()
                  || null,
                scope: field.scope,
              }),
            );

          return {
            id: category.id,
            client_key:
              category.client_key,
            name: category.name.trim(),
            code,
            inventory_group:
              category.inventory_group,
            specification_schema: {
              fields,
            },
          };
        },
      );

    return {
      sites: sites.map(
        (row) => ({
          id: row.id,
          client_key: row.client_key,
          name: row.name.trim(),
          street:
            row.street.trim()
            || null,
          street_number:
            row.street_number.trim()
            || null,
          postal_code:
            row.postal_code.trim()
            || null,
          city:
            row.city.trim()
            || null,
          country:
            row.country.trim()
            || null,
          organization_id:
            row.organization_id,
        }),
      ),

      departments: departments.map(
        (row) => ({
          id: row.id,
          client_key: row.client_key,
          name: row.name.trim(),
          organization_id:
            row.organization_id,
          site_ref: row.site_ref,
        }),
      ),

      storage_locations: locations.map(
        (row) => {
          const department =
            row.department_ref
              ? departmentByKey.get(
                  row.department_ref,
                )
              : undefined;

          return {
            id: row.id,
            client_key: row.client_key,
            name: row.name.trim(),
            department_ref:
              row.department_ref,
            site_ref:
              department?.site_ref
              ?? null,
            parent_location_id:
              row.parent_location_id,
            location_type:
              row.location_type,
            code: row.code,
            is_active: true,
          };
        },
      ),

      product_categories:
        categoryPayload,

      employees:
        employees.map(
          (row) => ({
            id: row.id,
            client_key:
              row.client_key,
            employee_number:
              row.employee_number.trim()
              || null,
            first_name:
              row.first_name.trim(),
            last_name:
              row.last_name.trim(),
            email:
              row.email.trim()
              || null,
            department_ref:
              row.department_ref,
            is_active:
              row.is_active,
            app_role:
              row.app_role,
          }),
        ),

      manufacturers:
        manufacturers.map(
          (row) => ({
            id: row.id,
            client_key: row.client_key,
            name: row.name.trim(),
          }),
        ),

      deleted,
    };
  }


  async function save(): Promise<void> {
    if (saving || loading || !savedSettings) {
      return;
    }

    const errors =
      validate();

    if (errors.length > 0) {
      showMessage(
        "Bitte korrigiere folgende Punkte:\n• "
        + errors.join("\n• "),
        "error",
      );
      return;
    }

    setSaving(true);
    showMessage(
      "Einstellungen werden gespeichert ...",
      "info",
    );

    try {
      const response = await fetch(
        `${API_BASE}/api/settings`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildPayload(),
          ),
        },
      );

      if (response.status === 401) {
        onSessionExpired();
        navigate(
          "/login",
          {
            replace: true,
          },
        );
        return;
      }

      if (!response.ok) {
        throw new Error(
          await responseError(
            response,
            "Einstellungen konnten nicht gespeichert werden.",
          ),
        );
      }

      localStorage.setItem(
        settingsStorageKey(email),
        JSON.stringify(
          columnOrder.filter(
            (column) =>
              defaultColumns.has(
                column,
              ),
          ),
        ),
      );

      setDeleted(
        emptyDeleted(),
      );
      setEditingRows(
        new Set(),
      );
      setEditingSpecIndex(
        null,
      );

      afterSaveRef.current = true;
      setReloadSequence(
        (current) =>
          current + 1,
      );

    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : "Einstellungen konnten nicht gespeichert werden.",
        "error",
      );

    } finally {
      setSaving(false);
    }
  }


  function toggleColumn(
    column: string,
    checked: boolean,
  ): void {
    setDefaultColumns(
      (current) => {
        const next =
          new Set(current);

        if (checked) {
          next.add(column);
        } else {
          next.delete(column);
        }

        return next;
      },
    );
  }


  function renderTextCell(
    key: string,
    value: string,
    onChange: (value: string) => void,
    options?: {
      readOnly?: boolean;
      placeholder?: string;
      autoFocus?: boolean;
    },
  ) {
    if (
      !editingRows.has(key)
      || options?.readOnly
    ) {
      return (
        <span className="settings-cell-text">
          {value || ""}
        </span>
      );
    }

    return (
      <input
        className="settings-cell-editor"
        type="text"
        value={value}
        placeholder={
          options?.placeholder
        }
        disabled={saving}
        autoFocus={options?.autoFocus}
        onClick={(event) =>
          event.stopPropagation()
        }
        onDoubleClick={(event) =>
          event.stopPropagation()
        }
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
      />
    );
  }


  function rowClass(
    selected: boolean,
    editing: boolean,
  ): string {
    return [
      selected ? "selected" : "",
      editing ? "editing" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }


  function selectionHint(
    label: string,
    name: string,
  ): void {
    showMessage(
      `${label} „${name || "ohne Name"}“ ausgewählt. Doppelklick oder „Bearbeiten“ aktiviert die Eingabefelder.`,
      "info",
    );
  }


  function renderStructure() {
    return (
      <div className="settings-structure-page">
        <header className="settings-page-intro">
          <h2>Standorte und Zuordnungen</h2>
          <p>Standort → Abteilung → Lagerort. Wähle eine Zeile aus und klicke auf „Bearbeiten“.</p>
        </header>

        <section className="settings-section">
          <div className="settings-section-header">
            <div>
              <h3>Standorte <span className="settings-count">{sites.length}</span></h3>
              <p>Adressen und Standorte deiner Organisation.</p>
            </div>
            <div className="settings-actions">
              <button type="button" onClick={addSite} disabled={saving}>Standort hinzufügen</button>
              <button type="button" onClick={() => toggleEditing(selectedSite, "Standort")} disabled={saving || !selectedSite}>{selectedSite && editingRows.has(selectedSite) ? "Bearbeitung beenden" : "Bearbeiten"}</button>
              <button type="button" onClick={deleteSite} disabled={saving || !selectedSite}>Löschen</button>
            </div>
          </div>

          <div className="settings-table-wrap">
            <table className="settings-table settings-sites-table" aria-label="Standorte">
              <thead>
                <tr>
                  <th>Standort</th>
                  <th>Strasse</th>
                  <th>Nr.</th>
                  <th>PLZ</th>
                  <th>Ort</th>
                  <th>Land</th>
                </tr>
              </thead>
              <tbody>
                {sites.length === 0 && <tr><td colSpan={6} className="settings-empty-state">Noch keine Standorte vorhanden. Mit „Standort hinzufügen“ beginnen.</td></tr>}
                {sites.map((row) => (
                  <tr
                    key={row.client_key}
                    className={rowClass(selectedSite === row.client_key, editingRows.has(row.client_key))}
                    tabIndex={0}
                    aria-selected={selectedSite === row.client_key}
                    onKeyDown={event => {
                      if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                      event.preventDefault();
                      setSelectedSite(row.client_key);
                      if (event.key === "Enter" && !saving) startEditing(row.client_key, "Standort");
                    }}
                    title="Klicken zum Auswählen · Doppelklick zum Bearbeiten"
                    onClick={() => { setSelectedSite(row.client_key); if (!editingRows.has(row.client_key)) selectionHint("Standort", row.name); }}
                    onDoubleClick={() => startEditing(row.client_key, "Standort")}
                  >
                    <td>{renderTextCell(row.client_key, row.name, (value) => setSites((current) => current.map((item) => item.client_key === row.client_key ? {...item, name: value} : item)), {autoFocus: true})}</td>
                    <td>{renderTextCell(row.client_key, row.street, (value) => setSites((current) => current.map((item) => item.client_key === row.client_key ? {...item, street: value} : item)))}</td>
                    <td>{renderTextCell(row.client_key, row.street_number, (value) => setSites((current) => current.map((item) => item.client_key === row.client_key ? {...item, street_number: value} : item)))}</td>
                    <td>{renderTextCell(row.client_key, row.postal_code, (value) => setSites((current) => current.map((item) => item.client_key === row.client_key ? {...item, postal_code: value} : item)))}</td>
                    <td>{renderTextCell(row.client_key, row.city, (value) => setSites((current) => current.map((item) => item.client_key === row.client_key ? {...item, city: value} : item)))}</td>
                    <td>{renderTextCell(row.client_key, row.country, (value) => setSites((current) => current.map((item) => item.client_key === row.client_key ? {...item, country: value} : item)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div>
              <h3>Abteilungen <span className="settings-count">{departments.length}</span></h3>
              <p>Abteilungen dem passenden Standort zuordnen.</p>
            </div>
            <div className="settings-actions">
              <button type="button" onClick={addDepartment} disabled={saving}>Abteilung hinzufügen</button>
              <button type="button" onClick={() => toggleEditing(selectedDepartment, "Abteilung")} disabled={saving || !selectedDepartment}>{selectedDepartment && editingRows.has(selectedDepartment) ? "Bearbeitung beenden" : "Bearbeiten"}</button>
              <button type="button" onClick={deleteDepartment} disabled={saving || !selectedDepartment}>Löschen</button>
            </div>
          </div>

          <div className="settings-table-wrap">
            <table className="settings-table settings-departments-table" aria-label="Abteilungen">
              <thead>
                <tr>
                  <th>Abteilung</th>
                  <th>Standort</th>
                </tr>
              </thead>
              <tbody>
                {departments.length === 0 && <tr><td colSpan={2} className="settings-empty-state">Noch keine Abteilungen vorhanden. Mit „Abteilung hinzufügen“ beginnen.</td></tr>}
                {departments.map((row) => {
                  const editing = editingRows.has(row.client_key);
                  return (
                    <tr
                      key={row.client_key}
                      className={rowClass(selectedDepartment === row.client_key, editing)}
                      tabIndex={0}
                      aria-selected={selectedDepartment === row.client_key}
                      onKeyDown={event => {
                        if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                        event.preventDefault();
                        setSelectedDepartment(row.client_key);
                        if (event.key === "Enter" && !saving) startEditing(row.client_key, "Abteilung");
                      }}
                      title="Klicken zum Auswählen · Doppelklick zum Bearbeiten"
                      onClick={() => { setSelectedDepartment(row.client_key); if (!editing) selectionHint("Abteilung", row.name); }}
                      onDoubleClick={() => startEditing(row.client_key, "Abteilung")}
                    >
                      <td>{renderTextCell(row.client_key, row.name, (value) => setDepartments((current) => current.map((item) => item.client_key === row.client_key ? {...item, name: value} : item)), {autoFocus: true})}</td>
                      <td>
                        {editing ? (
                          <select
                            className="settings-cell-editor"
                            value={row.site_ref ?? ""}
                            disabled={saving}
                            onChange={(event) => setDepartments((current) => current.map((item) => item.client_key === row.client_key ? {...item, site_ref: event.target.value || null, organization_id: null} : item))}
                          >
                            <option value="">Standort auswählen</option>
                            {sortedSites.map((site) => (
                              <option key={site.client_key} value={site.client_key}>{site.name || "(Standort ohne Name)"}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="settings-cell-text">{siteName(row.site_ref)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div>
              <h3>Lagerorte <span className="settings-count">{locations.length}</span></h3>
              <p>Lager, Bereiche und Räume innerhalb einer Abteilung verwalten.</p>
            </div>
            <div className="settings-actions">
              <button type="button" onClick={addLocation} disabled={saving}>Lagerort hinzufügen</button>
              <button type="button" onClick={() => toggleEditing(selectedLocation, "Lagerort")} disabled={saving || !selectedLocation}>{selectedLocation && editingRows.has(selectedLocation) ? "Bearbeitung beenden" : "Bearbeiten"}</button>
              <button type="button" onClick={deleteLocation} disabled={saving || !selectedLocation}>Löschen</button>
            </div>
          </div>

          <div className="settings-table-wrap">
            <table className="settings-table settings-locations-table" aria-label="Lagerorte">
              <thead>
                <tr>
                  <th>Lagerort</th>
                  <th>Abteilung</th>
                  <th>Standort</th>
                  <th>Typ</th>
                </tr>
              </thead>
              <tbody>
                {locations.length === 0 && <tr><td colSpan={4} className="settings-empty-state">Noch keine Lagerorte vorhanden. Mit „Lagerort hinzufügen“ beginnen.</td></tr>}
                {locations.map((row) => {
                  const editing = editingRows.has(row.client_key);
                  return (
                    <tr
                      key={row.client_key}
                      className={rowClass(selectedLocation === row.client_key, editing)}
                      tabIndex={0}
                      aria-selected={selectedLocation === row.client_key}
                      onKeyDown={event => {
                        if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                        event.preventDefault();
                        setSelectedLocation(row.client_key);
                        if (event.key === "Enter" && !saving) startEditing(row.client_key, "Lagerort");
                      }}
                      title="Klicken zum Auswählen · Doppelklick zum Bearbeiten"
                      onClick={() => { setSelectedLocation(row.client_key); if (!editing) selectionHint("Lagerort", row.name); }}
                      onDoubleClick={() => startEditing(row.client_key, "Lagerort")}
                    >
                      <td>{renderTextCell(row.client_key, row.name, (value) => setLocations((current) => current.map((item) => item.client_key === row.client_key ? {...item, name: value} : item)), {autoFocus: true})}</td>
                      <td>
                        {editing ? (
                          <select
                            className="settings-cell-editor"
                            value={row.department_ref ?? ""}
                            disabled={saving}
                            onChange={(event) => setLocations((current) => current.map((item) => item.client_key === row.client_key ? {...item, department_ref: event.target.value || null} : item))}
                          >
                            <option value="">Abteilung auswählen</option>
                            {sortedDepartments.map((department) => (
                              <option key={department.client_key} value={department.client_key}>{siteName(department.site_ref)} – {department.name || "(Abteilung ohne Name)"}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="settings-cell-text">{departmentByKey.get(row.department_ref ?? "")?.name ?? "Nicht zugeordnet"}</span>
                        )}
                      </td>
                      <td><span className="settings-cell-text">{locationSiteName(row.department_ref)}</span></td>
                      <td>
                        {editing ? (
                          <select
                            className="settings-cell-editor"
                            value={row.location_type}
                            disabled={saving}
                            onChange={(event) => setLocations((current) => current.map((item) => item.client_key === row.client_key ? {...item, location_type: event.target.value as keyof typeof LOCATION_TYPES} : item))}
                          >
                            {Object.entries(LOCATION_TYPES).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="settings-cell-text">{LOCATION_TYPES[row.location_type]}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    );
  }


  function renderCategories() {
    return (
      <div className="settings-single-page">
        <div className="settings-actions settings-actions-left">
          <button type="button" onClick={addCategory} disabled={saving}>Hinzufügen</button>
          <button type="button" onClick={() => toggleEditing(selectedCategory, "Kategorie")} disabled={saving || !selectedCategory}>{selectedCategory && editingRows.has(selectedCategory) ? "Bearbeitung beenden" : "Bearbeiten"}</button>
          <button type="button" onClick={deleteCategory} disabled={saving || !selectedCategory}>Löschen</button>
        </div>

        <div className="settings-table-wrap settings-table-grow">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Kategorie</th>
                <th>Inventartyp</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => {
                const editing = editingRows.has(row.client_key);
                return (
                  <tr
                    key={row.client_key}
                    className={rowClass(selectedCategory === row.client_key, editing)}
                    title="Klicken zum Auswählen · Doppelklick zum Bearbeiten"
                    onClick={() => { setSelectedCategory(row.client_key); if (!editing) selectionHint("Kategorie", row.name); }}
                    onDoubleClick={() => startEditing(row.client_key, "Kategorie")}
                  >
                    <td>{renderTextCell(row.client_key, row.name, (value) => setCategories((current) => current.map((item) => item.client_key === row.client_key ? {...item, name: value} : item)), {autoFocus: true})}</td>
                    <td>
                      {editing ? (
                        <select
                          className="settings-cell-editor"
                          value={row.inventory_group}
                          disabled={saving}
                          onChange={(event) => setCategories((current) => current.map((item) => item.client_key === row.client_key ? {...item, inventory_group: event.target.value} : item))}
                        >
                          {Object.entries(groupLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="settings-cell-text">{groupLabels[row.inventory_group] ?? row.inventory_group}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }


  function renderSpecifications() {
    const fields =
      currentSpecCategory
        ?.specification_schema
        .fields
      ?? [];

    return (
      <div className="settings-single-page">
        <div className="settings-spec-toolbar">
          <label htmlFor="settings-spec-category">Kategorie:</label>
          <select
            id="settings-spec-category"
            value={specCategoryKey}
            disabled={saving}
            onChange={(event) => {
              setSpecCategoryKey(event.target.value);
              setSelectedSpecIndex(null);
              setEditingSpecIndex(null);
            }}
          >
            {categories.length === 0 && (
              <option value="">Keine Kategorie vorhanden</option>
            )}
            {[...categories]
              .sort((left, right) => compareLabel(left.name, right.name))
              .map((category) => (
                <option key={category.client_key} value={category.client_key}>{category.name || "(Kategorie ohne Name)"}</option>
              ))}
          </select>
          <button type="button" onClick={addSpecification} disabled={saving}>Hinzufügen</button>
          <button type="button" onClick={() => {
            if (selectedSpecIndex === null) {
              showMessage(
                "Bitte zuerst eine Spezifikation auswählen.",
                "warning",
              );
              return;
            }

            if (editingSpecIndex === selectedSpecIndex) {
              setEditingSpecIndex(null);
              showMessage(
                "Bearbeitung der Spezifikation beendet. Änderungen bleiben bis „Übernehmen“ erhalten.",
                "warning",
              );
            } else {
              setEditingSpecIndex(selectedSpecIndex);
              showMessage(
                "Spezifikation wird bearbeitet. Änderungen werden erst mit „Übernehmen“ gespeichert.",
                "info",
              );
            }
          }} disabled={saving || selectedSpecIndex === null}>{editingSpecIndex === selectedSpecIndex && selectedSpecIndex !== null ? "Bearbeitung beenden" : "Bearbeiten"}</button>
          <button type="button" onClick={deleteSpecification} disabled={saving || selectedSpecIndex === null}>Löschen</button>
        </div>

        <div className="settings-table-wrap settings-table-grow">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Bezeichnung</th>
                <th>Typ</th>
                <th>Einheit</th>
                <th>Gültig für</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => {
                const editing =
                  editingSpecIndex === index;

                return (
                  <tr
                    key={`${currentSpecCategory?.client_key ?? "category"}:${field.key || index}`}
                    className={rowClass(selectedSpecIndex === index, editing)}
                    title="Klicken zum Auswählen · Doppelklick zum Bearbeiten"
                    onClick={() => { setSelectedSpecIndex(index); if (!editing) selectionHint("Spezifikation", field.label); }}
                    onDoubleClick={() => { setEditingSpecIndex(index); showMessage("Spezifikation wird bearbeitet. Änderungen werden erst mit „Übernehmen“ gespeichert.", "info"); }}
                  >
                    <td>
                      {editing ? (
                        <input
                          className="settings-cell-editor"
                          type="text"
                          value={field.label}
                          disabled={saving}
                          autoFocus
                          onChange={(event) => setCategories((current) => current.map((category) => category.client_key === currentSpecCategory?.client_key ? {...category, specification_schema: {fields: category.specification_schema.fields.map((item, itemIndex) => itemIndex === index ? {...item, label: event.target.value} : item)}} : category))}
                        />
                      ) : (
                        <span className="settings-cell-text">{field.label}</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select
                          className="settings-cell-editor"
                          value={field.type}
                          disabled={saving}
                          onChange={(event) => setCategories((current) => current.map((category) => category.client_key === currentSpecCategory?.client_key ? {...category, specification_schema: {fields: category.specification_schema.fields.map((item, itemIndex) => itemIndex === index ? {...item, type: event.target.value as keyof typeof SPEC_TYPES} : item)}} : category))}
                        >
                          {Object.entries(SPEC_TYPES).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="settings-cell-text">{SPEC_TYPES[field.type]}</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          className="settings-cell-editor"
                          type="text"
                          value={field.unit}
                          disabled={saving}
                          onChange={(event) => setCategories((current) => current.map((category) => category.client_key === currentSpecCategory?.client_key ? {...category, specification_schema: {fields: category.specification_schema.fields.map((item, itemIndex) => itemIndex === index ? {...item, unit: event.target.value} : item)}} : category))}
                        />
                      ) : (
                        <span className="settings-cell-text">{field.unit}</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select
                          className="settings-cell-editor"
                          value={field.scope}
                          disabled={saving}
                          onChange={(event) => setCategories((current) => current.map((category) => category.client_key === currentSpecCategory?.client_key ? {...category, specification_schema: {fields: category.specification_schema.fields.map((item, itemIndex) => itemIndex === index ? {...item, scope: event.target.value as keyof typeof SPEC_SCOPES} : item)}} : category))}
                        >
                          {Object.entries(SPEC_SCOPES).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="settings-cell-text">{SPEC_SCOPES[field.scope]}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }


  function renderManufacturers() {
    const selectedRow =
      manufacturers.find(
        (row) =>
          row.client_key === selectedManufacturer,
      )
      ?? null;

    const selectedProtected =
      selectedRow !== null
      && selectedRow.id !== null
      && selectedRow.id !== undefined
      && selectedRow.name.trim().toLocaleLowerCase() === "keiner";

    return (
      <div className="settings-single-page">
        <div className="settings-actions settings-actions-left">
          <button type="button" onClick={addManufacturer} disabled={saving}>Hinzufügen</button>
          <button type="button" onClick={() => toggleEditing(selectedManufacturer, "Hersteller")} disabled={saving || !selectedManufacturer || selectedProtected}>{selectedManufacturer && editingRows.has(selectedManufacturer) ? "Bearbeitung beenden" : "Bearbeiten"}</button>
          <button type="button" onClick={deleteManufacturer} disabled={saving || !selectedManufacturer || selectedProtected}>Löschen</button>
        </div>

        <div className="settings-table-wrap settings-table-grow">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Hersteller</th>
              </tr>
            </thead>
            <tbody>
              {manufacturers.map((row) => {
                const protectedRow =
                  row.id !== null
                  && row.id !== undefined
                  && row.name.trim().toLocaleLowerCase() === "keiner";
                return (
                  <tr
                    key={row.client_key}
                    className={rowClass(selectedManufacturer === row.client_key, editingRows.has(row.client_key))}
                    title={protectedRow ? "Technischer Eintrag – nicht bearbeitbar" : "Klicken zum Auswählen · Doppelklick zum Bearbeiten"}
                    onClick={() => { setSelectedManufacturer(row.client_key); if (!editingRows.has(row.client_key)) selectionHint("Hersteller", row.name); }}
                    onDoubleClick={() => !protectedRow && startEditing(row.client_key, "Hersteller")}
                  >
                    <td>{renderTextCell(row.client_key, row.name, (value) => setManufacturers((current) => current.map((item) => item.client_key === row.client_key ? {...item, name: value} : item)), {readOnly: protectedRow, autoFocus: true})}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }


  function renderPermissions() {
    const linkedUsers =
      employees
        .filter(
          (row) =>
            Boolean(
              row.auth_user_id,
            ),
        )
        .sort(
          (left, right) =>
            compareLabel(
              left.email,
              right.email,
            ),
        );

    return (
      <div className="settings-single-page">
        <div className="settings-permissions-intro">
          <strong>Benutzerberechtigungen</strong>
          <span>
            Administrator: vollständiger Zugriff · Bearbeiter: Inventar lesen und bearbeiten · Betrachter: nur lesen.
          </span>
        </div>

        <div className="settings-table-wrap settings-table-grow">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Benutzer</th>
                <th>E-Mail</th>
                <th>Rolle</th>
              </tr>
            </thead>

            <tbody>
              {linkedUsers.map(
                (row) => {
                  const isCurrentUser =
                    row.email
                      .trim()
                      .toLocaleLowerCase()
                    === email
                      .trim()
                      .toLocaleLowerCase();

                  const displayName =
                    [
                      row.first_name,
                      row.last_name,
                    ]
                      .filter(Boolean)
                      .join(" ")
                    || row.email;

                  return (
                    <tr
                      key={
                        row.client_key
                      }
                    >
                      <td>
                        <div className="settings-cell-text">
                          {displayName}
                        </div>
                      </td>

                      <td>
                        <div className="settings-cell-text">
                          {row.email}
                          {isCurrentUser
                            ? " (angemeldet)"
                            : ""}
                        </div>
                      </td>

                      <td>
                        <select
                          className="settings-role-select"
                          value={
                            row.app_role
                          }
                          disabled={
                            saving
                            || isCurrentUser
                          }
                          title={
                            isCurrentUser
                              ? "Die eigene Administratorrolle kann hier nicht geändert werden."
                              : "Berechtigungsrolle auswählen"
                          }
                          onChange={
                            (event) => {
                              const nextRole =
                                event.target.value as AppRole;

                              setEmployees(
                                (current) =>
                                  current.map(
                                    (item) =>
                                      item.client_key
                                      === row.client_key
                                        ? {
                                            ...item,
                                            app_role:
                                              nextRole,
                                          }
                                        : item,
                                  ),
                              );

                              showMessage(
                                `Rolle für ${row.email} geändert. Mit „Übernehmen“ speichern.`,
                                "info",
                              );
                            }
                          }
                        >
                          <option value="admin">
                            Administrator
                          </option>
                          <option value="user">
                            Bearbeiter
                          </option>
                          <option value="viewer">
                            Betrachter
                          </option>
                        </select>
                      </td>
                    </tr>
                  );
                },
              )}

              {linkedUsers.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <div className="settings-cell-text">
                      Keine mit Supabase Auth verknüpften Benutzer vorhanden.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }


  function renderColumns() {
    return (
      <div className="settings-columns-page">
        <p>
          Wähle die Spalten, die bei „Standardansicht“ sichtbar sein sollen.
        </p>

        <div className="settings-actions settings-actions-left">
          <button type="button" disabled={saving} onClick={() => setDefaultColumns(new Set(columnOrder))}>Alle auswählen</button>
          <button type="button" disabled={saving} onClick={() => setDefaultColumns(new Set(factoryColumns))}>Werkseinstellung</button>
        </div>

        <div className="settings-columns-box">
          {columnOrder.map((column) => (
            <label className={`settings-column-check${defaultColumns.has(column) ? " checked" : ""}`} key={column}>
              <input
                type="checkbox"
                checked={defaultColumns.has(column)}
                disabled={saving}
                onChange={(event) => toggleColumn(column, event.target.checked)}
              />
              <span>{headers[column] ?? column.replaceAll("_", " ")}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }


  if (loading) {
    return (
      <div className="settings-page settings-loading">
        Einstellungen werden geladen ...
      </div>
    );
  }


  return (
    <div className="settings-page">
      <div className="settings-window">
        <header className="settings-titlebar">
          <div>
            <h1>Einstellungen</h1>
            <p>Stammdaten und Darstellung von ITAssetFlow verwalten.</p>
          </div>
          <button type="button" disabled={saving || modelSaving} onClick={closeSettings}>← Zurück zum Inventar</button>
        </header>

        <nav className="settings-tabs" role="tablist" aria-label="Einstellungsbereiche">
          {SETTINGS_TABS.map(([key, label], index) => (
            <button
              type="button"
              key={key}
              id={`settings-tab-${key}`}
              role="tab"
              aria-selected={activeTab === key}
              aria-controls="settings-panel"
              tabIndex={activeTab === key ? 0 : -1}
              className={activeTab === key ? "active" : ""}
              disabled={saving || modelSaving}
              onClick={() => changeTab(key)}
              onKeyDown={event => navigateTabs(event, index)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === "product-models" ? (
          <ProductModelsPage
            ref={modelEditor}
            onSessionExpired={onSessionExpired}
            onEditSpecifications={editModelSpecifications}
            onSavingChange={setModelSaving}
            pendingSettings={hasSettingsChanges}
          />
        ) : (
          <>
            <main className="settings-content" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`}>
              {!savedSettings ? (
                <div className="settings-empty-state">
                  <p>Die Einstellungen konnten nicht geladen werden.</p>
                  <button type="button" onClick={() => setReloadSequence(value => value + 1)}>Erneut laden</button>
                </div>
              ) : (
                <>
                  {activeTab === "structure" && renderStructure()}
                  {activeTab === "categories" && renderCategories()}
                  {activeTab === "specifications" && renderSpecifications()}
                  {activeTab === "manufacturers" && renderManufacturers()}
                  {activeTab === "permissions" && renderPermissions()}
                  {activeTab === "columns" && renderColumns()}
                </>
              )}
            </main>
            <div className={`settings-message ${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>
              {message}
            </div>
            <footer className="settings-footer">
              <span className="settings-save-state">{hasSettingsChanges ? "Nicht gespeicherte Einstellungen" : ""}</span>
              <button type="button" disabled={saving} onClick={closeSettings}>Schliessen</button>
              <button type="button" className="primary-button" disabled={saving || !savedSettings} onClick={() => void save()}>
                {saving ? "Wird gespeichert …" : "Übernehmen"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
