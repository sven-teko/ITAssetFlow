import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FormEvent, ReactNode, Ref } from "react";
import { UnauthorizedError } from "../api/inventoryApi";
import { createProductModel, deleteProductModel, loadProductModels, saveProductModel } from "../api/productModelsApi";
import { createModelDraft, modelChanges, modelSpecificationFields } from "../utils/productModels";
import type { ModelDraft, ProductModel, ProductModelsData } from "../utils/productModels";
import "./AssetFormPage.css";
import "./ProductModelsPage.css";

const MODEL_NAME_COLLATOR = new Intl.Collator("de-CH", { sensitivity: "base", numeric: true });

function compareModels(left: ProductModel, right: ProductModel): number {
  return MODEL_NAME_COLLATOR.compare(left.name.trim(), right.name.trim())
    || String(left.id).localeCompare(String(right.id));
}

function FormRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="asset-form-row">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export type ProductModelsHandle = { confirmLeave: () => boolean };

type ProductModelsPageProps = {
  ref?: Ref<ProductModelsHandle>;
  onSessionExpired: () => void;
  onEditSpecifications: (categoryId: string) => void;
  onSavingChange: (saving: boolean) => void;
  pendingSettings: boolean;
};

export default function ProductModelsPage({
  ref, onSessionExpired, onEditSpecifications, onSavingChange, pendingSettings,
}: ProductModelsPageProps) {
  const [data, setData] = useState<ProductModelsData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [newModel, setNewModel] = useState<ProductModel | null>(null);
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const creating = newModel !== null;
  const selected = newModel ?? data?.product_models.find(model => String(model.id) === selectedId);
  const category = data?.product_categories.find(row => String(row.id) === String(selected?.category_id));
  const fields = modelSpecificationFields(selected, category?.fields ?? []);
  const dirty = creating || Boolean(selected && draft && JSON.stringify(draft) !== JSON.stringify(createModelDraft(selected, fields)));

  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  useImperativeHandle(ref, () => ({
    confirmLeave: () => !saving && (!dirty || window.confirm("Nicht gespeicherte Modelländerungen verwerfen?")),
  }), [dirty, saving]);

  useEffect(() => {
    onSavingChange(saving);
    return () => onSavingChange(false);
  }, [onSavingChange, saving]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProductModels(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const models = [...result.product_models].sort(compareModels);
      setData({ ...result, product_models: models });
      const first = models[0];
      setSelectedId(first ? String(first.id) : "");
      setDraft(first ? createModelDraft(first, modelSpecificationFields(first, result.product_categories.find(row => String(row.id) === String(first.category_id))?.fields ?? [])) : null);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof UnauthorizedError) onSessionExpired();
      else setError(cause instanceof Error ? cause.message : "Die Produktmodelle konnten nicht geladen werden.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [onSessionExpired, loadAttempt]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty, saving]);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error]);

  function mayDiscard(): boolean {
    return !saving && (!dirty || window.confirm("Nicht gespeicherte Änderungen verwerfen?"));
  }

  function selectModel(model: ProductModel): void {
    if (String(model.id) === selectedId || !mayDiscard()) return;
    const modelCategory = data?.product_categories.find(row => String(row.id) === String(model.category_id));
    setSelectedId(String(model.id));
    setDraft(createModelDraft(model, modelSpecificationFields(model, modelCategory?.fields ?? [])));
    setError("");
    setSuccess("");
  }

  function startCreate(): void {
    if (!data || creating || !mayDiscard()) return;
    const categoryId = categoryFilter || String(selected?.category_id ?? data.product_categories[0]?.id ?? "");
    const model: ProductModel = {
      id: "", name: "", manufacturer_id: null, category_id: categoryId,
      part_number: null, sku: null, tracking_mode: "serialized", unit_code: "piece",
      is_active: true, specifications: {},
    };
    setNewModel(model);
    setDraft(createModelDraft(model, modelSpecificationFields(model, data.product_categories.find(row => String(row.id) === categoryId)?.fields ?? [])));
    setError("");
    setSuccess("");
  }

  function changeCategory(categoryId: string): void {
    if (!newModel || !draft || categoryId === String(newModel.category_id)) return;
    if (Object.values(draft.specifications).some(value => value.trim())
      && !window.confirm("Kategorie wechseln und die eingegebenen Spezifikationen verwerfen?")) return;
    const model = { ...newModel, category_id: categoryId };
    setNewModel(model);
    const nextFields = modelSpecificationFields(model, data?.product_categories.find(row => String(row.id) === categoryId)?.fields ?? []);
    changeDraft({ specifications: createModelDraft(model, nextFields).specifications });
  }

  function discardChanges(): void {
    if (!mayDiscard()) return;
    const model = data?.product_models.find(row => String(row.id) === selectedId);
    const modelCategory = data?.product_categories.find(row => String(row.id) === String(model?.category_id));
    setNewModel(null);
    setDraft(model ? createModelDraft(model, modelSpecificationFields(model, modelCategory?.fields ?? [])) : null);
    setError("");
    setSuccess("");
  }

  async function removeModel(): Promise<void> {
    if (!selected || !data || creating || saving) return;
    if (!window.confirm(`Produktmodell „${selected.name}“ wirklich löschen?${dirty ? " Nicht gespeicherte Änderungen werden dabei verworfen." : ""}`)) return;
    setSaving(true);
    setDeleting(true);
    setError("");
    setSuccess("");
    try {
      await deleteProductModel(selected.id);
      const models = data.product_models.filter(model => String(model.id) !== String(selected.id));
      const next = models.find(model => !categoryFilter || String(model.category_id) === categoryFilter) ?? models[0];
      const nextCategory = data.product_categories.find(row => String(row.id) === String(next?.category_id));
      setData({ ...data, product_models: models });
      if (next && categoryFilter && String(next.category_id) !== categoryFilter) setCategoryFilter("");
      setSelectedId(next ? String(next.id) : "");
      setDraft(next ? createModelDraft(next, modelSpecificationFields(next, nextCategory?.fields ?? [])) : null);
      setSuccess(`„${selected.name}“ wurde gelöscht.`);
    } catch (cause) {
      if (cause instanceof UnauthorizedError) onSessionExpired();
      else setError(cause instanceof Error ? cause.message : "Das Modell konnte nicht gelöscht werden.");
    } finally {
      setSaving(false);
      setDeleting(false);
    }
  }

  function changeDraft(change: Partial<ModelDraft>): void {
    setDraft(current => current ? { ...current, ...change } : current);
    setSuccess("");
    setError("");
  }

  function retryLoad(): void {
    setLoading(true);
    setError("");
    setLoadAttempt(attempt => attempt + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !draft || saving || !dirty) return;
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      if (creating && !draft.manufacturer_id) throw new Error("Bitte einen Hersteller auswählen.");
      const changes = modelChanges(selected, fields, draft);
      const saved = creating ? await createProductModel({
        ...changes, name: draft.name.trim(), manufacturer_id: draft.manufacturer_id,
        category_id: selected.category_id, tracking_mode: selected.tracking_mode, unit_code: selected.unit_code,
      }) : await saveProductModel(selected.id, changes);
      setData(current => current ? {
        ...current,
        product_models: [...current.product_models.filter(model => String(model.id) !== String(saved.id)), saved]
          .sort(compareModels),
      } : current);
      if (creating && categoryFilter && String(saved.category_id) !== categoryFilter) setCategoryFilter("");
      setNewModel(null);
      setSelectedId(String(saved.id));
      setDraft(createModelDraft(saved, modelSpecificationFields(saved, category?.fields ?? [])));
      setSuccess(`„${saved.name}“ wurde ${creating ? "hinzugefügt" : "gespeichert"}.`);
    } catch (cause) {
      if (cause instanceof UnauthorizedError) onSessionExpired();
      else setError(cause instanceof Error ? cause.message : "Das Modell konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  const manufacturerName = (id: ProductModel["manufacturer_id"]) => {
    const name = data?.manufacturers.find(row => String(row.id) === String(id))?.name.trim() ?? "";
    return name.toLocaleLowerCase("de") === "keiner" ? "" : name;
  };
  const categoryName = (id: ProductModel["category_id"]) =>
    data?.product_categories.find(row => String(row.id) === String(id))?.name ?? "Ohne Kategorie";
  const visibleModels = data?.product_models.filter(model =>
    !categoryFilter || String(model.category_id) === categoryFilter,
  ) ?? [];
  const selectableModels = selected && !creating && visibleModels.length > 0 && !visibleModels.some(model => String(model.id) === selectedId)
    ? [...visibleModels, selected].sort(compareModels)
    : visibleModels;

  return (
    <form className="product-models-panel" onSubmit={event => void save(event)} aria-busy={loading || saving}>
      <main className="settings-content" id="settings-panel" role="tabpanel" aria-labelledby="settings-tab-product-models">
        <div className="product-models-page">
          {loading ? <p role="status">Produktmodelle werden geladen …</p> : !data ? (
            <button type="button" onClick={retryLoad}>Erneut laden</button>
          ) : (
            <>
              <fieldset className="product-models-selection" disabled={saving}>
                <legend>Modell auswählen</legend>
                <div className="product-models-filters">
                  <div>
                    <label htmlFor="model-category-filter">Kategorie</label>
                    <select id="model-category-filter" className="asset-form-control" value={categoryFilter} disabled={creating} onChange={event => setCategoryFilter(event.target.value)}>
                      <option value="">Alle Kategorien</option>
                      {data.product_categories.map(row => <option key={row.id} value={String(row.id)}>{row.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="model-select">Produktmodell</label>
                    <select
                      id="model-select"
                      className="asset-form-control"
                      value={!creating && visibleModels.length ? selectedId : ""}
                      disabled={creating || visibleModels.length === 0}
                      title={visibleModels.length ? undefined : "Keine Produktmodelle verfügbar"}
                      onChange={event => {
                        const model = data.product_models.find(row => String(row.id) === event.target.value);
                        if (model) selectModel(model);
                      }}
                    >
                      {creating ? <option value="">Neues Produktmodell</option> : !visibleModels.length && <option value="" disabled hidden />}
                      {selectableModels.map(model => (
                        <option key={model.id} value={String(model.id)}>
                          {model.name}{manufacturerName(model.manufacturer_id) ? ` · ${manufacturerName(model.manufacturer_id)}` : ""}
                          {model.is_active === false ? " (inaktiv)" : ""}
                          {!visibleModels.includes(model) ? " (aktuelle Auswahl)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="product-models-toolbar">
                  <button type="button" disabled={creating || !data.product_categories.length || !data.manufacturers.length} onClick={startCreate}>Produktmodell hinzufügen</button>
                  <button type="button" className="product-models-delete" disabled={creating || !selected} onClick={() => void removeModel()}>Produktmodell löschen</button>
                </div>
                {(!data.product_categories.length || !data.manufacturers.length) && <p className="asset-form-empty-info">Zum Hinzufügen zuerst eine Kategorie und einen Hersteller in den Einstellungen anlegen.</p>}
              </fieldset>
              {selected && draft ? (
                <div className="asset-form-columns">
                    <div className="asset-form-column">
                      <fieldset className="asset-form-group" disabled={saving}>
                        <legend>Allgemeine Angaben</legend>
                        {newModel && (
                          <FormRow id="model-new-category" label="Produktkategorie *:">
                            <select id="model-new-category" className="asset-form-control" required value={String(newModel.category_id)} onChange={event => changeCategory(event.target.value)}>
                              {data.product_categories.map(row => <option key={row.id} value={String(row.id)}>{row.name}</option>)}
                            </select>
                          </FormRow>
                        )}
                        <FormRow id="model-name" label="Bezeichnung *:">
                          <input ref={nameRef} id="model-name" className="asset-form-control" type="text" required value={draft.name} onChange={event => changeDraft({ name: event.target.value })} />
                        </FormRow>
                        <FormRow id="model-manufacturer" label={creating ? "Hersteller *:" : "Hersteller:"}>
                          <select id="model-manufacturer" className="asset-form-control" required={creating} value={draft.manufacturer_id} onChange={event => changeDraft({ manufacturer_id: event.target.value })}>
                            {!data.manufacturers.some(row => String(row.id) === draft.manufacturer_id) && <option value={draft.manufacturer_id} disabled>{creating ? "Bitte auswählen" : draft.manufacturer_id ? "Bisheriger Hersteller" : "Kein Hersteller hinterlegt"}</option>}
                            {data.manufacturers.map(row => <option key={row.id} value={String(row.id)}>{row.name}</option>)}
                          </select>
                        </FormRow>
                        {newModel && <>
                          <FormRow id="model-new-tracking" label="Verwaltungsart *:">
                            <select id="model-new-tracking" className="asset-form-control" value={newModel.tracking_mode} onChange={event => setNewModel({ ...newModel, tracking_mode: event.target.value })}>
                              <option value="serialized">Einzelartikel</option><option value="quantity">Mengenbestand</option>
                            </select>
                          </FormRow>
                          <FormRow id="model-new-unit" label="Einheit *:">
                            <select id="model-new-unit" className="asset-form-control" value={newModel.unit_code} onChange={event => setNewModel({ ...newModel, unit_code: event.target.value })}>
                              <option value="piece">Stück</option><option value="meter">Meter</option><option value="pack">Packung</option><option value="box">Box</option>
                            </select>
                          </FormRow>
                        </>}
                        <FormRow id="model-part-number" label="Artikelnummer:">
                          <input id="model-part-number" className="asset-form-control" type="text" value={draft.part_number} onChange={event => changeDraft({ part_number: event.target.value })} />
                        </FormRow>
                        <FormRow id="model-sku" label="SKU:">
                          <input id="model-sku" className="asset-form-control" type="text" value={draft.sku} onChange={event => changeDraft({ sku: event.target.value })} />
                        </FormRow>
                      </fieldset>
                    </div>
                    <div className="asset-form-column">
                      <fieldset className="asset-form-group" disabled={saving}>
                        <legend>Spezifikationen – {categoryName(selected.category_id)}</legend>
                        {fields.length ? fields.map(field => (
                          <FormRow key={field.key} id={`model-spec-${field.key}`} label={`${field.label}${field.unit ? ` [${field.unit}]` : ""}:`}>
                            {field.type === "boolean" ? (
                              <select id={`model-spec-${field.key}`} className="asset-form-control" value={draft.specifications[field.key] ?? ""} onChange={event => changeDraft({ specifications: { ...draft.specifications, [field.key]: event.target.value } })}>
                                <option value="">Nicht gesetzt</option><option value="true">Ja</option><option value="false">Nein</option>
                              </select>
                            ) : field.type === "json" ? (
                              <textarea
                                id={`model-spec-${field.key}`}
                                className="asset-form-control asset-form-textarea product-models-json"
                                title="Strukturierte Angaben im JSON-Format"
                                spellCheck={false}
                                value={draft.specifications[field.key] ?? ""}
                                onChange={event => changeDraft({ specifications: { ...draft.specifications, [field.key]: event.target.value } })}
                              />
                            ) : (
                              <input id={`model-spec-${field.key}`} className="asset-form-control" type="text" inputMode={field.type === "integer" ? "numeric" : field.type === "number" ? "decimal" : undefined} value={draft.specifications[field.key] ?? ""} onChange={event => changeDraft({ specifications: { ...draft.specifications, [field.key]: event.target.value } })} />
                            )}
                          </FormRow>
                        )) : <p className="asset-form-empty-info">Für dieses Modell sind noch keine Spezifikationen vorhanden.</p>}
                        <div className="product-models-spec-footer">
                          <button type="button" onClick={() => onEditSpecifications(String(selected.category_id))}>Spezifikationsfelder verwalten</button>
                        </div>
                      </fieldset>
                    </div>
                </div>
              ) : <p className="settings-empty-state">Noch keine Produktmodelle vorhanden. Klicke auf „Produktmodell hinzufügen“.</p>}
            </>
          )}
        </div>
      </main>
      {(error || success || pendingSettings) && (
        <div className={`settings-message ${error ? "error" : success ? "success" : "info"}`} role={error ? "alert" : "status"} tabIndex={-1} ref={errorRef}>
          {error || success}
          {pendingSettings && <div>In anderen Einstellungsreitern sind noch nicht gespeicherte Änderungen vorhanden.</div>}
        </div>
      )}
      <footer className="settings-footer product-models-actions">
        <span>{dirty ? "Nicht gespeicherte Modelländerungen" : ""}</span>
        <button type="button" disabled={saving || !dirty} onClick={discardChanges}>{creating ? "Abbrechen" : "Änderungen verwerfen"}</button>
        <button type="submit" className="primary-button" disabled={loading || saving || !dirty}>{deleting ? "Wird gelöscht …" : saving ? "Wird gespeichert …" : creating ? "Produktmodell speichern" : "Änderungen speichern"}</button>
      </footer>
    </form>
  );
}
