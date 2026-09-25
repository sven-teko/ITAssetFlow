import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./AssetFormPage.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  `${window.location.protocol}//${window.location.hostname}:8000`;

type GenericRow = Record<string, unknown>;

type FormDataResponse = {
  product_categories: GenericRow[];
  manufacturers: GenericRow[];
  product_models: GenericRow[];
  sites: GenericRow[];
  storage_locations: GenericRow[];
  employees: GenericRow[];
  departments: GenericRow[];
  parent_assets: GenericRow[];
  edit_entry?: GenericRow;
};

type InventoryMeta = {
  status_labels: Record<string, string>;
  condition_labels: Record<string, string>;
};

type SpecificationField = {
  key?: unknown;
  label?: unknown;
  unit?: unknown;
  type?: unknown;
  scope?: unknown;
};

type SpecificationValue = string | number | boolean | null;

type ModelMode = "existing" | "new";

type TrackingMode = "serialized" | "quantity" | "hybrid";

type EntryType = "asset" | "stock";

type AssetFormPageProps = {
  onSessionExpired: () => void;
};

const STATUS_ORDER = ["available", "in_use", "defective", "in_repair"];

const CONDITION_ORDER = ["new", "like_new", "used", "defective"];

const TRACKING_LABELS: Record<string, string> = {
  serialized: "Einzelartikel",
  quantity: "Mengenbestand",
  hybrid: "Hybrid",
};

function idText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function sameId(left: unknown, right: unknown): boolean {
  return idText(left) === idText(right);
}

function rowById(rows: GenericRow[], id: string): GenericRow | null {
  return rows.find((row) => sameId(row.id, id)) ?? null;
}

function originalId(rows: GenericRow[], id: string): unknown | null {
  return rowById(rows, id)?.id ?? null;
}

function categoryLabel(category: GenericRow | null): string {
  return (
    String(category?.name ?? "").trim() ||
    String(category?.code ?? "").trim() ||
    "Unbekannte Kategorie"
  );
}

function compareNames(left: GenericRow, right: GenericRow): number {
  return String(left.name ?? "").localeCompare(String(right.name ?? ""), "de-CH", {
    sensitivity: "base",
  });
}

function errorDetail(payload: unknown, fallback: string): string {
  return typeof payload === "object" &&
    payload !== null &&
    "detail" in payload &&
    typeof payload.detail === "string"
    ? payload.detail
    : fallback;
}

function specificationFields(category: GenericRow | null): SpecificationField[] {
  if (!category) {
    return [];
  }

  const schema = category.specification_schema;

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return [];
  }

  const fields = (schema as Record<string, unknown>).fields;

  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.filter(
    (field): field is SpecificationField =>
      typeof field === "object" &&
      field !== null &&
      !Array.isArray(field) &&
      String((field as SpecificationField).key ?? "").trim().length > 0,
  );
}

function specKey(field: SpecificationField): string {
  return String(field.key ?? "")
    .trim()
    .toLocaleLowerCase();
}

function specScope(field: SpecificationField): "model" | "asset" {
  return String(field.scope ?? "model")
    .trim()
    .toLocaleLowerCase() === "asset"
    ? "asset"
    : "model";
}

function specType(field: SpecificationField): string {
  return String(field.type ?? "text")
    .trim()
    .toLocaleLowerCase();
}

function specLabel(field: SpecificationField, scopeLabel: string): string {
  const label = String(field.label ?? field.key ?? "Spezifikation").trim();
  const unit = String(field.unit ?? "").trim();

  return `${unit ? `${label} [${unit}]` : label} (${scopeLabel})`;
}

function displaySpecValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Ja" : "Nein";
  }

  return String(value);
}

function parseCHF(value: string): number {
  let normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace("chf", "")
    .trim()
    .replaceAll("’", "'")
    .replaceAll("'", "")
    .replaceAll(" ", "");

  if (normalized.endsWith(".-") || normalized.endsWith(",-")) {
    normalized = normalized.slice(0, -2);
  }

  normalized = normalized.replace(/-+$/, "").replaceAll(",", ".");
  const number = Number(normalized);

  if (!Number.isFinite(number)) {
    throw new Error("Neupreis enthält keinen gültigen CHF-Betrag (z. B. CHF 100.-).");
  }

  if (number < 0) {
    throw new Error("Neupreis darf nicht negativ sein.");
  }

  return number;
}

function formatCHF(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const whole = Math.trunc(rounded);
  const cents = Math.round((rounded - whole) * 100);
  const wholeText = whole.toLocaleString("en-US").replaceAll(",", "'");

  return cents === 0 ? `CHF ${wholeText}.-` : `CHF ${wholeText}.` + String(cents).padStart(2, "0");
}

function todayISO(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 10);
}

function dateInputValue(value: unknown): string {
  const text = String(value ?? "").trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }

  return "";
}

function editableSpecifications(value: unknown): Record<string, SpecificationValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, SpecificationValue> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean" ||
      raw === null
    ) {
      result[key.trim().toLocaleLowerCase()] = raw as SpecificationValue;
    }
  }

  return result;
}

export default function AssetFormPage({ onSessionExpired }: AssetFormPageProps) {
  const navigate = useNavigate();
  const { entryKey } = useParams<{
    entryKey: string;
  }>();
  const isEditMode = Boolean(entryKey);
  const [formData, setFormData] = useState<FormDataResponse | null>(null);
  const [editEntry, setEditEntry] = useState<GenericRow | null>(null);
  const [meta, setMeta] = useState<InventoryMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

  const [modelMode, setModelMode] = useState<ModelMode>("existing");
  const [categoryId, setCategoryId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [manufacturerText, setManufacturerText] = useState("Keiner");
  const [newTrackingMode, setNewTrackingMode] = useState<TrackingMode>("serialized");
  const [hybridEntryType, setHybridEntryType] = useState<EntryType>("asset");

  const [status, setStatus] = useState("available");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [newPrice, setNewPrice] = useState("");

  const [assetTag, setAssetTag] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [assetNote, setAssetNote] = useState("");

  const [quantity, setQuantity] = useState("");
  const [stockNote, setStockNote] = useState("");

  const [condition, setCondition] = useState("used");
  const [siteId, setSiteId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [parentAssetId, setParentAssetId] = useState("");
  const [employeeId, setEmployeeId] = useState("");

  const [specValues, setSpecValues] = useState<Record<string, SpecificationValue>>({});
  const errorMessageRef = useRef<HTMLDivElement>(null);

  // Fehlermeldungen auch bei langen Formularen sichtbar und fokussierbar machen.
  useEffect(() => {
    if (errorMessage && !loading) {
      errorMessageRef.current?.focus({ preventScroll: true });
      errorMessageRef.current?.scrollIntoView({ block: "start" });
    }
  }, [errorMessage, loading]);

  useEffect(() => {
    async function loadForm(): Promise<void> {
      setLoading(true);
      setErrorMessage("");

      try {
        const [formResponse, metaResponse] = await Promise.all([
          fetch(
            isEditMode
              ? `${API_BASE}/api/inventory/edit-form-data` +
                  `?entry_key=${encodeURIComponent(entryKey ?? "")}`
              : `${API_BASE}/api/inventory/form-data`,
            {
              credentials: "include",
            },
          ),

          fetch(`${API_BASE}/api/inventory/meta`, {
            credentials: "include",
          }),
        ]);

        if (formResponse.status === 401 || metaResponse.status === 401) {
          onSessionExpired();
          navigate("/login", {
            replace: true,
          });

          return;
        }

        const formPayload: unknown = await formResponse.json();
        const metaPayload: unknown = await metaResponse.json();

        if (!formResponse.ok) {
          throw new Error(
            errorDetail(
              formPayload,
              "Die Stammdaten für den neuen Eintrag konnten nicht geladen werden.",
            ),
          );
        }

        if (!metaResponse.ok) {
          throw new Error("Status- und Zustandsinformationen konnten nicht geladen werden.");
        }

        const data = formPayload as FormDataResponse;
        setFormData(data);
        setMeta(metaPayload as InventoryMeta);

        const currentEdit =
          typeof data.edit_entry === "object" &&
          data.edit_entry !== null &&
          !Array.isArray(data.edit_entry)
            ? data.edit_entry
            : null;
        setEditEntry(currentEdit);

        if (isEditMode && !currentEdit) {
          throw new Error("Der ausgewählte Inventareintrag konnte nicht geladen werden.");
        }

        if (currentEdit) {
          const currentModel =
            data.product_models.find((model) => sameId(model.id, currentEdit.product_model_id)) ??
            null;
          setModelMode("existing");
          setSelectedModelId(idText(currentEdit.product_model_id));
          setCategoryId(currentModel ? idText(currentModel.category_id) : "");

          const recordType = String(currentEdit._record_type ?? "asset")
            .trim()
            .toLocaleLowerCase();
          setHybridEntryType(recordType === "stock" ? "stock" : "asset");
          setStatus(
            String(currentEdit.status ?? "available")
              .trim()
              .toLocaleLowerCase(),
          );
          setCondition(
            String(currentEdit.condition ?? "used")
              .trim()
              .toLocaleLowerCase(),
          );
          setPurchaseDate(dateInputValue(currentEdit.purchase_date) || todayISO());

          const price = Number(currentEdit.new_price ?? 0);
          setNewPrice(Number.isFinite(price) ? formatCHF(price) : "");

          const nextLocationId = idText(currentEdit.storage_location_id);
          const nextDepartmentId = idText(
            recordType === "asset"
              ? (currentEdit.assigned_department_id ?? currentEdit.department_id)
              : currentEdit.department_id,
          );
          const currentLocation = rowById(data.storage_locations, nextLocationId);
          const currentDepartment = rowById(data.departments, nextDepartmentId);
          const nextSiteId = idText(
            currentEdit.site_id ?? currentLocation?.site_id ?? currentDepartment?.site_id,
          );
          setSiteId(nextSiteId);
          setDepartmentId(nextDepartmentId);
          setLocationId(nextLocationId);

          if (recordType === "asset") {
            setAssetTag(String(currentEdit.asset_tag ?? ""));
            setSerialNumber(String(currentEdit.serial_number ?? ""));
            setWarrantyUntil(dateInputValue(currentEdit.warranty_until));
            setAssetNote(String(currentEdit.note ?? ""));
            setEmployeeId(idText(currentEdit.assigned_employee_id));
            setParentAssetId(idText(currentEdit.connected_product_id));
            setSpecValues(editableSpecifications(currentEdit.specifications));
          } else {
            const currentQuantity = currentEdit.stock_quantity ?? currentEdit.quantity ?? "";
            setQuantity(String(currentQuantity));
            setStockNote(String(currentEdit.note ?? ""));
            setEmployeeId("");
            setParentAssetId("");
            setSpecValues({});
          }
        } else if (data.product_categories[0]) {
          setCategoryId(idText(data.product_categories[0].id));
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Die Eingabedaten konnten nicht geladen werden.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadForm();
  }, [entryKey, isEditMode, navigate, onSessionExpired]);
  const categories = useMemo(
    () =>
      [...(formData?.product_categories ?? [])].sort((left, right) =>
        categoryLabel(left).localeCompare(categoryLabel(right), "de-CH", {
          sensitivity: "base",
        }),
      ),
    [formData],
  );
  const currentCategory = useMemo(
    () => rowById(formData?.product_categories ?? [], categoryId),
    [categoryId, formData],
  );
  const manufacturersById = useMemo(
    () => new Map((formData?.manufacturers ?? []).map((row) => [idText(row.id), row] as const)),
    [formData],
  );
  const editRecordType = String(editEntry?._record_type ?? "asset")
    .trim()
    .toLocaleLowerCase();
  const existingModels = useMemo(
    () =>
      (formData?.product_models ?? [])
        .filter((model) => {
          if (!sameId(model.category_id, categoryId)) {
            return false;
          }

          const isCurrentEditModel = isEditMode && sameId(model.id, editEntry?.product_model_id);

          if (!(model.is_active ?? true) && !isCurrentEditModel) {
            return false;
          }

          if (!isEditMode) {
            return true;
          }

          const trackingMode = String(model.tracking_mode ?? "")
            .trim()
            .toLocaleLowerCase();

          return editRecordType === "stock"
            ? trackingMode === "quantity" || trackingMode === "hybrid"
            : trackingMode === "serialized" || trackingMode === "hybrid";
        })
        .sort(compareNames),
    [categoryId, editEntry, editRecordType, formData, isEditMode],
  );

  // Nach einem Kategorienwechsel ein verfügbares Modell auswählen und alte Eingaben verwerfen.
  const availableModelId = existingModels.some((model) => sameId(model.id, selectedModelId))
    ? selectedModelId
    : idText(existingModels[0]?.id);

  if (modelMode === "existing" && selectedModelId !== availableModelId) {
    setSelectedModelId(availableModelId);
    setSpecValues({});
  }

  const selectedModel = useMemo(
    () => rowById(formData?.product_models ?? [], selectedModelId),
    [formData, selectedModelId],
  );
  const currentTrackingMode: TrackingMode =
    modelMode === "existing"
      ? (String(selectedModel?.tracking_mode ?? "serialized") as TrackingMode)
      : newTrackingMode;
  const currentEntryType: EntryType = isEditMode
    ? editRecordType === "stock"
      ? "stock"
      : "asset"
    : currentTrackingMode === "quantity"
      ? "stock"
      : currentTrackingMode === "serialized"
        ? "asset"
        : hybridEntryType;
  const currentSpecificationFields = useMemo(
    () => specificationFields(currentCategory),
    [currentCategory],
  );
  const availableDepartments = useMemo(
    () =>
      (formData?.departments ?? [])
        .filter((department) => siteId !== "" && sameId(department.site_id, siteId))
        .sort(compareNames),
    [formData, siteId],
  );
  const availableLocations = useMemo(
    () =>
      (formData?.storage_locations ?? [])
        .filter(
          (location) =>
            Boolean(location.is_active ?? true) &&
            siteId !== "" &&
            departmentId !== "" &&
            sameId(location.site_id, siteId) &&
            sameId(location.department_id, departmentId),
        )
        .sort(compareNames),
    [formData, siteId, departmentId],
  );
  const availableEmployees = useMemo(
    () =>
      (formData?.employees ?? [])
        .filter(
          (employee) =>
            Boolean(employee.is_active ?? true) &&
            (departmentId === "" || sameId(employee.department_id, departmentId)),
        )
        .sort((left, right) => {
          const leftName = `${String(left.last_name ?? "")} ${String(left.first_name ?? "")}`;
          const rightName = `${String(right.last_name ?? "")} ${String(right.first_name ?? "")}`;

          return leftName.localeCompare(rightName, "de-CH", {
            sensitivity: "base",
          });
        }),
    [formData, departmentId],
  );
  const showParentAsset =
    String(currentCategory?.inventory_group ?? "")
      .trim()
      .toLocaleLowerCase() === "component" && currentEntryType === "asset";

  function clearInvalid(key: string): void {
    setInvalidFields((current) => {
      if (!current.has(key)) {
        return current;
      }

      const next = new Set(current);
      next.delete(key);

      return next;
    });
  }

  function handleCategoryChange(value: string): void {
    setCategoryId(value);
    setSelectedModelId("");
    setSpecValues({});
    setParentAssetId("");
    clearInvalid("category");
  }

  function handleModelModeChange(value: ModelMode): void {
    setModelMode(value);
    setSpecValues({});
    clearInvalid("model");
    clearInvalid("model_name");
  }

  function handleSiteChange(value: string): void {
    setSiteId(value);
    clearInvalid("site");

    if (!formData) {
      setDepartmentId("");
      setLocationId("");
      setEmployeeId("");

      return;
    }

    const currentDepartment = rowById(formData.departments, departmentId);
    const keepDepartment = currentDepartment !== null && sameId(currentDepartment.site_id, value);

    if (!keepDepartment) {
      setDepartmentId("");
      setLocationId("");
      setEmployeeId("");

      return;
    }

    const currentLocation = rowById(formData.storage_locations, locationId);

    if (
      !currentLocation ||
      !sameId(currentLocation.site_id, value) ||
      !sameId(currentLocation.department_id, departmentId)
    ) {
      setLocationId("");
    }
  }

  function handleDepartmentChange(value: string): void {
    setDepartmentId(value);
    clearInvalid("department");

    if (!formData) {
      setLocationId("");
      setEmployeeId("");

      return;
    }

    const currentLocation = rowById(formData.storage_locations, locationId);

    if (
      !currentLocation ||
      !sameId(currentLocation.site_id, siteId) ||
      !sameId(currentLocation.department_id, value)
    ) {
      setLocationId("");
    }

    const currentEmployee = rowById(formData.employees, employeeId);

    if (currentEmployee && !sameId(currentEmployee.department_id, value)) {
      setEmployeeId("");
    }
  }

  function handleEmployeeChange(value: string): void {
    setEmployeeId(value);

    if (!value || !formData) {
      return;
    }

    const employee = rowById(formData.employees, value);
    const employeeDepartmentId = employee ? idText(employee.department_id) : "";

    if (!employeeDepartmentId) {
      return;
    }

    const department = rowById(formData.departments, employeeDepartmentId);

    if (!department) {
      return;
    }

    const nextSiteId = idText(department.site_id);
    const nextDepartmentId = idText(department.id);
    setSiteId(nextSiteId);
    setDepartmentId(nextDepartmentId);
    const currentLocation = rowById(formData.storage_locations, locationId);

    if (
      !currentLocation ||
      !sameId(currentLocation.site_id, nextSiteId) ||
      !sameId(currentLocation.department_id, nextDepartmentId)
    ) {
      setLocationId("");
    }

    clearInvalid("site");
    clearInvalid("department");
  }

  function setSpecValue(key: string, value: SpecificationValue): void {
    setSpecValues((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function collectSpecifications(scope: "model" | "asset"): Record<string, unknown> {
    // Modellwerte werden nur für neue Modelle, Gerätewerte nur für Einzelartikel gespeichert.
    if (
      (scope === "model" && modelMode !== "new") ||
      (scope === "asset" && currentEntryType !== "asset")
    ) {
      return {};
    }

    const result: Record<string, unknown> = {};

    for (const field of currentSpecificationFields) {
      if (specScope(field) !== scope) {
        continue;
      }

      const key = specKey(field);
      const value = specValues[key];

      if (value === null || value === undefined || value === "") {
        continue;
      }

      const type = specType(field);
      const label = String(field.label ?? field.key ?? "Spezifikation");

      if (type === "integer") {
        const parsed = Number(value);

        if (!Number.isInteger(parsed)) {
          throw new Error(`'${label}' muss eine ganze Zahl sein.`);
        }

        result[key] = parsed;
      } else if (type === "number") {
        const parsed = Number(String(value).replace(",", "."));

        if (!Number.isFinite(parsed)) {
          throw new Error(`'${label}' muss eine Zahl sein.`);
        }

        result[key] = parsed;
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  function buildPayload(): Record<string, unknown> {
    if (!formData) {
      throw new Error("Die Stammdaten sind noch nicht geladen.");
    }

    const errors = new Set<string>();
    const missing: string[] = [];
    const requireField = (conditionMissing: boolean, key: string, label: string) => {
      if (conditionMissing) {
        errors.add(key);
        missing.push(label);
      }
    };
    requireField(!categoryId, "category", "Produktkategorie");
    requireField(modelMode === "existing" && !selectedModel, "model", "Produktmodell");
    requireField(
      modelMode === "new" && !modelName.trim(),
      "model_name",
      "Bezeichnung (Produktmodell)",
    );
    requireField(!currentTrackingMode, "tracking", "Verwaltungsart");
    requireField(currentEntryType === "asset" && !assetTag.trim(), "asset_tag", "Produkterkennung");
    requireField(!condition, "condition", "Zustand");
    requireField(!siteId, "site", "Standort");
    requireField(!departmentId, "department", "Abteilung");
    requireField(!locationId, "location", "Lagerort");
    requireField(!status, "status", "Status");
    requireField(!purchaseDate, "purchase_date", "Kaufdatum");
    setInvalidFields(errors);

    if (missing.length > 0) {
      throw new Error(
        "Folgende Pflichtfelder müssen noch ausgefüllt werden:\n\n" +
          missing.map((label) => `• ${label}`).join("\n"),
      );
    }

    const price = newPrice.trim() ? parseCHF(newPrice) : 0;
    let modelPayload: Record<string, unknown>;

    if (modelMode === "existing") {
      modelPayload = {
        mode: "existing",
        id: selectedModel?.id ?? null,
        tracking_mode: currentTrackingMode,
        unit_code: selectedModel?.unit_code ?? "piece",
      };
    } else {
      const normalizedManufacturer = manufacturerText.trim() || "Keiner";
      const existingManufacturer = formData.manufacturers.find(
        (manufacturer) =>
          String(manufacturer.name ?? "")
            .trim()
            .toLocaleLowerCase() === normalizedManufacturer.toLocaleLowerCase(),
      );
      modelPayload = {
        mode: "new",
        category_id: originalId(formData.product_categories, categoryId),
        manufacturer_id:
          normalizedManufacturer.toLocaleLowerCase() === "keiner"
            ? null
            : (existingManufacturer?.id ?? null),
        manufacturer_name: normalizedManufacturer,
        name: modelName.trim(),
        tracking_mode: currentTrackingMode,
        unit_code: "piece",
        specifications: collectSpecifications("model"),
      };
    }

    const departmentOriginalId = originalId(formData.departments, departmentId);
    const payload: Record<string, unknown> = {
      model: modelPayload,
      entry_type: currentEntryType,
      condition,
      storage_location_id: originalId(formData.storage_locations, locationId),
    };

    if (currentEntryType === "asset") {
      payload.asset = {
        asset_tag: assetTag.trim(),
        serial_number: serialNumber.trim() || null,
        status,
        purchase_date: purchaseDate,
        new_price: price,
        warranty_until: warrantyUntil || null,
        retired_at: null,
        note: assetNote.trim() || null,
        specifications: collectSpecifications("asset"),
      };
      payload.assignment = {
        employee_id: employeeId ? originalId(formData.employees, employeeId) : null,
        department_id: departmentOriginalId,
      };
      payload.parent_asset_id =
        showParentAsset && parentAssetId ? originalId(formData.parent_assets, parentAssetId) : null;
    } else {
      let stockQuantity = 1;

      if (quantity.trim()) {
        stockQuantity = Number(quantity);

        if (!Number.isInteger(stockQuantity) || stockQuantity <= 0) {
          throw new Error("Menge muss eine ganze Zahl grösser als 0 sein.");
        }
      }

      payload.stock = {
        quantity: stockQuantity,
        department_id: departmentOriginalId,
        status,
        purchase_date: purchaseDate,
        new_price: price,
        note: stockNote.trim() || null,
      };
    }

    if (isEditMode && editEntry) {
      payload.edit = {
        record_type: editRecordType,
        id: editEntry.id ?? null,
        product_model_id: editEntry.product_model_id ?? null,
        storage_location_id: editEntry.storage_location_id ?? null,
        condition: editEntry.condition ?? null,
        stock_quantity: editEntry.stock_quantity ?? null,
        source_movement_id: editEntry.source_movement_id ?? null,
      };
    }

    return payload;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (saving) {
      return;
    }

    setErrorMessage("");
    let payload: Record<string, unknown>;

    try {
      payload = buildPayload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Bitte prüfe die Eingaben.");

      return;
    }

    setSaving(true);
    const saveErrorMessage = isEditMode
      ? "Der Inventareintrag konnte nicht aktualisiert werden."
      : "Der Inventareintrag konnte nicht gespeichert werden.";

    try {
      const response = await fetch(`${API_BASE}/api/inventory`, {
        method: isEditMode ? "PUT" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        onSessionExpired();
        navigate("/login", {
          replace: true,
        });

        return;
      }

      const data: unknown = await response.json();

      if (!response.ok) {
        throw new Error(errorDetail(data, saveErrorMessage));
      }

      navigate("/inventory", {
        replace: true,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : saveErrorMessage);
    } finally {
      setSaving(false);
    }
  }

  function fieldClass(key: string): string {
    return invalidFields.has(key) ? "asset-form-control " + "input-error" : "asset-form-control";
  }

  if (loading) {
    return (
      <div className="asset-form-page">
        <div className="asset-form-loading">
          {isEditMode
            ? "Daten für den Inventareintrag " + "werden geladen ..."
            : "Stammdaten für den neuen Eintrag " + "werden geladen ..."}
        </div>
      </div>
    );
  }

  if (!formData || !meta) {
    return (
      <div className="asset-form-page">
        <div className="asset-form-error-page">
          <h1>{isEditMode ? "Inventareintrag bearbeiten" : "Neuer Inventareintrag"}</h1>
          <p>{errorMessage || "Die Formulardaten sind nicht verfügbar."}</p>
          <button type="button" onClick={() => navigate("/inventory")}>
            Zurück zum Inventar
          </button>
        </div>
      </div>
    );
  }

  const selectedModelManufacturer = selectedModel
    ? (manufacturersById.get(idText(selectedModel.manufacturer_id)) ?? null)
    : null;
  const selectedModelCategory = selectedModel
    ? rowById(formData.product_categories, idText(selectedModel.category_id))
    : null;
  const modelSpecifications =
    selectedModel &&
    typeof selectedModel.specifications === "object" &&
    selectedModel.specifications !== null &&
    !Array.isArray(selectedModel.specifications)
      ? (selectedModel.specifications as Record<string, unknown>)
      : {};

  return (
    <div className="asset-form-page">
      <form className="asset-form-shell" onSubmit={(event) => void submit(event)}>
        <header className="asset-form-header">
          <div>
            <h1>{isEditMode ? "Inventareintrag bearbeiten" : "Neuer Inventareintrag"}</h1>
            <p>
              {isEditMode
                ? "Bestehenden Einzelartikel oder " + "Mengenbestand bearbeiten."
                : "Einzelartikel oder Mengenbestand " + "im IT-Inventar erfassen."}
            </p>
          </div>
          <button
            type="button"
            className="asset-form-back-button"
            disabled={saving}
            onClick={() => navigate("/inventory")}
          >
            ← Zurück zum Inventar
          </button>
        </header>
        {errorMessage && (
          <div
            className="asset-form-error-message"
            ref={errorMessageRef}
            role="alert"
            tabIndex={-1}
          >
            {errorMessage}
          </div>
        )}
        <div className="asset-form-columns">
          {/* Linke Spalte */}
          <div className="asset-form-column">
            <fieldset className="asset-form-group">
              <legend>Produktmodell</legend>
              <div className="asset-form-row">
                <label>Auswahl:</label>
                <select
                  className="asset-form-control"
                  value={modelMode}
                  disabled={saving || isEditMode}
                  onChange={(event) => handleModelModeChange(event.target.value as ModelMode)}
                >
                  <option value="existing">Vorhandenes Produktmodell verwenden</option>
                  <option value="new">Neues Produktmodell anlegen</option>
                </select>
              </div>
              {modelMode === "existing" && (
                <div className="asset-form-row">
                  <label>Produktmodell *:</label>
                  <select
                    className={fieldClass("model")}
                    value={selectedModelId}
                    disabled={saving || existingModels.length === 0}
                    onChange={(event) => {
                      setSelectedModelId(event.target.value);
                      setSpecValues({});
                      clearInvalid("model");
                    }}
                  >
                    {existingModels.length === 0 && (
                      <option value="">Kein aktives Produktmodell vorhanden</option>
                    )}
                    {existingModels.map((model) => {
                      const manufacturer = manufacturersById.get(idText(model.manufacturer_id));
                      const manufacturerName = String(manufacturer?.name ?? "").trim();
                      const name = String(model.name ?? "Unbenannt").trim();
                      const label = [manufacturerName, name].filter(Boolean).join(" · ");

                      return (
                        <option key={idText(model.id)} value={idText(model.id)}>
                          {label || name}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              {modelMode === "existing" && (
                <div className="asset-form-row asset-form-info-row">
                  <span />
                  <div className="asset-form-info-box">
                    {selectedModel ? (
                      <>
                        <div>Kategorie: {categoryLabel(selectedModelCategory)}</div>
                        <div>Hersteller: {String(selectedModelManufacturer?.name ?? "—")}</div>
                        <div>
                          Verwaltungsart:{" "}
                          {TRACKING_LABELS[currentTrackingMode] ?? currentTrackingMode}
                        </div>
                      </>
                    ) : (
                      <span>
                        Für diese Artikelart ist noch kein aktives Produktmodell vorhanden. Wähle
                        „Neues Produktmodell anlegen“.
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="asset-form-row">
                <label>Produktkategorie *:</label>
                <select
                  className={fieldClass("category")}
                  value={categoryId}
                  disabled={saving}
                  onChange={(event) => handleCategoryChange(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={idText(category.id)} value={idText(category.id)}>
                      {categoryLabel(category)}
                    </option>
                  ))}
                </select>
              </div>
              {modelMode === "new" && (
                <>
                  <div className="asset-form-row">
                    <label>Bezeichnung *:</label>
                    <input
                      type="text"
                      className={fieldClass("model_name")}
                      value={modelName}
                      disabled={saving}
                      onChange={(event) => {
                        setModelName(event.target.value);
                        clearInvalid("model_name");
                      }}
                    />
                  </div>
                  <div className="asset-form-row">
                    <label>Hersteller:</label>
                    <div>
                      <input
                        type="text"
                        list="manufacturer-options"
                        className="asset-form-control"
                        value={manufacturerText}
                        disabled={saving}
                        onChange={(event) => setManufacturerText(event.target.value)}
                      />
                      <datalist id="manufacturer-options">
                        <option value="Keiner" />
                        {formData.manufacturers.map((manufacturer) => (
                          <option
                            key={idText(manufacturer.id)}
                            value={String(manufacturer.name ?? "")}
                          />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <div className="asset-form-row">
                    <label>Verwaltungsart *:</label>
                    <select
                      className={fieldClass("tracking")}
                      value={newTrackingMode}
                      disabled={saving}
                      onChange={(event) => {
                        setNewTrackingMode(event.target.value as TrackingMode);
                        setSpecValues({});
                        clearInvalid("tracking");
                      }}
                    >
                      <option value="serialized">Einzelartikel</option>
                      <option value="quantity">Mengenbestand</option>
                    </select>
                  </div>
                </>
              )}
            </fieldset>
            <fieldset className="asset-form-group">
              <legend>Spezifikationen – {categoryLabel(currentCategory)}</legend>
              {currentSpecificationFields.length === 0 && (
                <div className="asset-form-empty-info">
                  Für diese Kategorie sind keine Spezifikationsfelder definiert.
                </div>
              )}
              {currentSpecificationFields.map((field) => {
                const key = specKey(field);
                const scope = specScope(field);

                if (scope === "asset" && currentEntryType !== "asset") {
                  return null;
                }

                if (scope === "model" && modelMode === "existing") {
                  return (
                    <div className="asset-form-row" key={`${scope}:${key}`}>
                      <label>{specLabel(field, "Modell")}:</label>
                      <div className="asset-form-readonly-value">
                        {displaySpecValue(modelSpecifications[key])}
                      </div>
                    </div>
                  );
                }

                const value = specValues[key] ?? null;
                const type = specType(field);

                return (
                  <div className="asset-form-row" key={`${scope}:${key}`}>
                    <label>{specLabel(field, scope === "model" ? "Modell" : "Asset")}:</label>
                    {type === "boolean" ? (
                      <select
                        className="asset-form-control"
                        value={value === true ? "true" : value === false ? "false" : ""}
                        disabled={saving}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setSpecValue(key, raw === "true" ? true : raw === "false" ? false : null);
                        }}
                      >
                        <option value="">Nicht gesetzt</option>
                        <option value="true">Ja</option>
                        <option value="false">Nein</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        inputMode={
                          type === "integer" ? "numeric" : type === "number" ? "decimal" : undefined
                        }
                        className="asset-form-control"
                        value={value === null ? "" : String(value)}
                        disabled={saving}
                        onChange={(event) => setSpecValue(key, event.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
            {/* Hybrid-Eintragsart */}
            {!isEditMode && currentTrackingMode === "hybrid" && (
              <fieldset className="asset-form-group">
                <legend>Eintragsart</legend>
                <div className="asset-form-row">
                  <label>Für Hybrid-Modell:</label>
                  <select
                    className="asset-form-control"
                    value={hybridEntryType}
                    disabled={saving}
                    onChange={(event) => {
                      setHybridEntryType(event.target.value as EntryType);
                      setSpecValues({});
                    }}
                  >
                    <option value="asset">Einzelnes Asset</option>
                    <option value="stock">Mengenbestand</option>
                  </select>
                </div>
              </fieldset>
            )}
          </div>
          {/* Rechte Spalte */}
          <div className="asset-form-column">
            <fieldset className="asset-form-group">
              <legend>Allgemeine Angaben</legend>
              <div className="asset-form-row">
                <label>Status *:</label>
                <select
                  className={fieldClass("status")}
                  value={status}
                  disabled={saving}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    clearInvalid("status");
                  }}
                >
                  {STATUS_ORDER.map((key) => (
                    <option key={key} value={key}>
                      {meta.status_labels[key] ?? key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="asset-form-row">
                <label>Kaufdatum *:</label>
                <input
                  type="date"
                  className={fieldClass("purchase_date")}
                  value={purchaseDate}
                  disabled={saving}
                  onChange={(event) => {
                    setPurchaseDate(event.target.value);
                    clearInvalid("purchase_date");
                  }}
                />
              </div>
              <div className="asset-form-row">
                <label>Neupreis:</label>
                <input
                  type="text"
                  className="asset-form-control"
                  placeholder="CHF 0.-"
                  value={newPrice}
                  disabled={saving}
                  onChange={(event) => setNewPrice(event.target.value)}
                  onBlur={() => {
                    if (!newPrice.trim()) {
                      return;
                    }

                    try {
                      setNewPrice(formatCHF(parseCHF(newPrice)));
                    } catch {
                      // Ungültige Preise bleiben bis zur Prüfung beim Speichern sichtbar.
                    }
                  }}
                />
              </div>
            </fieldset>
            {currentEntryType === "asset" ? (
              <fieldset className="asset-form-group">
                <legend>Einzelartikel</legend>
                <div className="asset-form-row">
                  <label>Produkterkennung *:</label>
                  <input
                    type="text"
                    className={fieldClass("asset_tag")}
                    placeholder="z. B. IT-000123"
                    value={assetTag}
                    disabled={saving}
                    onChange={(event) => {
                      setAssetTag(event.target.value);
                      clearInvalid("asset_tag");
                    }}
                  />
                </div>
                <div className="asset-form-row">
                  <label>Seriennummer:</label>
                  <input
                    type="text"
                    className="asset-form-control"
                    value={serialNumber}
                    disabled={saving}
                    onChange={(event) => setSerialNumber(event.target.value)}
                  />
                </div>
                <div className="asset-form-row">
                  <label>Garantie bis:</label>
                  <input
                    type="date"
                    className="asset-form-control"
                    value={warrantyUntil}
                    disabled={saving}
                    onChange={(event) => setWarrantyUntil(event.target.value)}
                  />
                </div>
                <div className="asset-form-row asset-form-row-top">
                  <label>Bemerkungen:</label>
                  <textarea
                    className="asset-form-control asset-form-textarea"
                    value={assetNote}
                    disabled={saving}
                    onChange={(event) => setAssetNote(event.target.value)}
                  />
                </div>
              </fieldset>
            ) : (
              <fieldset className="asset-form-group">
                <legend>Mengenbestand</legend>
                <div className="asset-form-row">
                  <label>Menge [Stück] *:</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="asset-form-control"
                    placeholder="leer = 1"
                    value={quantity}
                    disabled={saving}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </div>
                <div className="asset-form-row asset-form-row-top">
                  <label>Bemerkungen:</label>
                  <textarea
                    className="asset-form-control asset-form-textarea asset-form-textarea-small"
                    value={stockNote}
                    disabled={saving}
                    onChange={(event) => setStockNote(event.target.value)}
                  />
                </div>
              </fieldset>
            )}
            <fieldset className="asset-form-group">
              <legend>Zustand und Standort</legend>
              <div className="asset-form-row">
                <label>Zustand *:</label>
                <select
                  className={fieldClass("condition")}
                  value={condition}
                  disabled={saving}
                  onChange={(event) => {
                    setCondition(event.target.value);
                    clearInvalid("condition");
                  }}
                >
                  {CONDITION_ORDER.map((key) => (
                    <option key={key} value={key}>
                      {meta.condition_labels[key] ?? key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="asset-form-row">
                <label>Standort *:</label>
                <select
                  className={fieldClass("site")}
                  value={siteId}
                  disabled={saving}
                  onChange={(event) => handleSiteChange(event.target.value)}
                >
                  <option value="">Bitte Standort auswählen *</option>
                  {[...formData.sites]
                    .sort((left, right) =>
                      String(left.name ?? "").localeCompare(String(right.name ?? ""), "de-CH", {
                        sensitivity: "base",
                      }),
                    )
                    .map((site) => (
                      <option key={idText(site.id)} value={idText(site.id)}>
                        {String(site.name ?? `Standort #` + idText(site.id))}
                      </option>
                    ))}
                </select>
              </div>
              <div className="asset-form-row">
                <label>Abteilung *:</label>
                <select
                  className={fieldClass("department")}
                  value={departmentId}
                  disabled={saving || !siteId}
                  onChange={(event) => handleDepartmentChange(event.target.value)}
                >
                  <option value="">Bitte Abteilung auswählen *</option>
                  {availableDepartments.map((department) => (
                    <option key={idText(department.id)} value={idText(department.id)}>
                      {String(department.name ?? `Abteilung #` + idText(department.id))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="asset-form-row">
                <label>Lagerort *:</label>
                <select
                  className={fieldClass("location")}
                  value={locationId}
                  disabled={saving || !siteId || !departmentId}
                  onChange={(event) => {
                    setLocationId(event.target.value);
                    clearInvalid("location");
                  }}
                >
                  <option value="">Bitte Lagerort auswählen *</option>
                  {availableLocations.map((location) => (
                    <option key={idText(location.id)} value={idText(location.id)}>
                      {String(location.name ?? `Lagerort #` + idText(location.id))}
                    </option>
                  ))}
                </select>
              </div>
              {showParentAsset && (
                <div className="asset-form-row">
                  <label>Verbunden mit:</label>
                  <select
                    className="asset-form-control"
                    value={parentAssetId}
                    disabled={saving}
                    onChange={(event) => setParentAssetId(event.target.value)}
                  >
                    <option value="">Nicht verbunden</option>
                    {[...formData.parent_assets]
                      .sort((left, right) =>
                        String(left.label ?? "").localeCompare(String(right.label ?? ""), "de-CH", {
                          sensitivity: "base",
                        }),
                      )
                      .map((asset) => (
                        <option key={idText(asset.id)} value={idText(asset.id)}>
                          {String(asset.label ?? `Asset #` + idText(asset.id))}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div className="asset-form-row">
                <label>Mitarbeiter:</label>
                <select
                  className="asset-form-control"
                  value={employeeId}
                  disabled={saving || currentEntryType !== "asset"}
                  onChange={(event) => handleEmployeeChange(event.target.value)}
                >
                  <option value="">Keine Mitarbeiterzuweisung</option>
                  {availableEmployees.map((employee) => {
                    const fullName = [
                      String(employee.first_name ?? "").trim(),

                      String(employee.last_name ?? "").trim(),
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <option key={idText(employee.id)} value={idText(employee.id)}>
                        {fullName || `Mitarbeiter #` + idText(employee.id)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </fieldset>
          </div>
        </div>
        <footer className="asset-form-actions">
          <button type="button" disabled={saving} onClick={() => navigate("/inventory")}>
            Abbrechen
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving
              ? "Wird gespeichert ..."
              : isEditMode
                ? "Änderungen speichern"
                : "Eintrag speichern"}
          </button>
        </footer>
      </form>
    </div>
  );
}
