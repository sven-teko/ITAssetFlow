export type ModelField = {
  key: string;
  label: string;
  unit: string;
  type: "text" | "integer" | "number" | "boolean" | "json";
};

export type ModelCategory = {
  id: string | number;
  name: string;
  fields: ModelField[];
};

export type ProductModel = {
  id: string | number;
  name: string;
  manufacturer_id: string | number | null;
  category_id: string | number;
  part_number: string | null;
  sku: string | null;
  tracking_mode: string;
  unit_code: string;
  is_active: boolean;
  specifications: Record<string, unknown>;
  specification_fields?: ModelField[];
};

export type ProductModelsData = {
  product_models: ProductModel[];
  product_categories: ModelCategory[];
  manufacturers: Array<{ id: string | number; name: string }>;
};

export type ModelDraft = {
  name: string;
  manufacturer_id: string;
  part_number: string;
  sku: string;
  specifications: Record<string, string>;
};

function editableSpecification(field: ModelField): boolean {
  const key = field.key.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return key !== "component_type" && key !== "komponentenart";
}

export function modelSpecificationFields(model: ProductModel | undefined, fields: ModelField[]): ModelField[] {
  if (model?.specification_fields) return model.specification_fields.filter(editableSpecification);
  const knownKeys = new Set(fields.map(field => field.key));
  const storedFields: ModelField[] = Object.entries(model?.specifications ?? {})
    .filter(([key]) => !knownKeys.has(key))
    .map(([key, value]) => ({
      key,
      label: key.replaceAll("_", " ").replace(/^./, letter => letter.toLocaleUpperCase("de")),
      unit: "",
      type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number"
        : value !== null && typeof value === "object" ? "json" : "text",
    }));
  return [...fields, ...storedFields].filter(editableSpecification);
}

function isFiniteJson(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value !== null && typeof value === "object") return Object.values(value).every(isFiniteJson);
  return true;
}

export function specificationText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function createModelDraft(model: ProductModel, fields: ModelField[]): ModelDraft {
  return {
    name: model.name,
    manufacturer_id: String(model.manufacturer_id ?? ""),
    part_number: model.part_number ?? "",
    sku: model.sku ?? "",
    specifications: Object.fromEntries(fields.map(({ key }) => [key, specificationText(model.specifications[key])])),
  };
}

export function modelChanges(model: ProductModel, fields: ModelField[], draft: ModelDraft): Record<string, unknown> {
  if (!draft.name.trim()) throw new Error("Bitte eine Modellbezeichnung eingeben.");
  const original = createModelDraft(model, fields);
  const changes: Record<string, unknown> = {};
  for (const key of ["name", "part_number", "sku"] as const) {
    if (draft[key] !== original[key]) changes[key] = draft[key].trim() || null;
  }
  if (draft.manufacturer_id !== original.manufacturer_id) {
    if (!draft.manufacturer_id) throw new Error("Bitte einen Hersteller auswählen.");
    changes.manufacturer_id = draft.manufacturer_id;
  }
  const specifications: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = draft.specifications[field.key] ?? "";
    if (raw === original.specifications[field.key]) continue;
    const text = raw.trim();
    let value: unknown = text || null;
    if (text && field.type === "boolean") {
      if (text !== "true" && text !== "false") throw new Error(`Bitte für „${field.label}“ Ja oder Nein auswählen.`);
      value = text === "true";
    } else if (text && (field.type === "integer" || field.type === "number")) {
      const number = Number(text.replace(",", "."));
      if (!Number.isFinite(number) || (field.type === "integer" && !Number.isSafeInteger(number))) {
        throw new Error(`Bitte für „${field.label}“ eine gültige ${field.type === "integer" ? "Ganzzahl" : "Zahl"} eingeben.`);
      }
      value = number;
    } else if (text && field.type === "json") {
      try {
        value = JSON.parse(text);
        if (value === null || typeof value !== "object" || !isFiniteJson(value)
          || Array.isArray(value) !== Array.isArray(model.specifications[field.key])) throw new Error();
      } catch {
        throw new Error(`Bitte für „${field.label}“ ${Array.isArray(model.specifications[field.key]) ? "eine gültige JSON-Liste" : "ein gültiges JSON-Objekt"} eingeben.`);
      }
    }
    specifications[field.key] = value;
  }
  if (Object.keys(specifications).length) changes.specifications = specifications;
  return changes;
}
