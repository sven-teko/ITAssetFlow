type InventoryRow =
  Record<string, unknown>;


type AssetDetailPanelProps = {
  rows: InventoryRow[];

  getIdentifier: (
    row: InventoryRow,
  ) => string;

  getHeaderLabel: (
    column: string,
  ) => string;

  formatValue: (
    column: string,
    value: unknown,
  ) => string;
};


const GENERAL_FIELDS = [
  "asset_tag",
  "serial_number",
  "product_model_name",
  "manufacturer_name",
  "product_category_name",
  "condition",
  "stock_quantity",
  "site_name",
  "department_name",
  "storage_location",
  "connected_product",
  "status",
  "product_model_part_number",
  "purchase_date",
  "new_price",
  "warranty_until",
  "note",
];


function isEmpty(
  value: unknown,
): boolean {
  if (
    value === null
    || value === undefined
  ) {
    return true;
  }

  if (
    typeof value === "string"
  ) {
    return !value.trim();
  }

  return false;
}


function normalizeValue(
  value: unknown,
): string {
  if (
    typeof value === "string"
  ) {
    return value
      .trim()
      .toLocaleLowerCase();
  }

  if (
    typeof value === "object"
    && value !== null
  ) {
    try {
      return JSON.stringify(
        value,
      );
    } catch {
      return String(value);
    }
  }

  return String(
    value ?? "",
  );
}


function commonValue(
  rows: InventoryRow[],
  field: string,
): unknown | null {
  if (
    rows.length === 0
  ) {
    return null;
  }

  const values =
    rows.map(
      (row) =>
        row[field],
    );

  if (
    values.some(
      isEmpty,
    )
  ) {
    return null;
  }

  const first =
    normalizeValue(
      values[0],
    );

  if (
    values.every(
      (value) =>
        normalizeValue(
          value,
        ) === first,
    )
  ) {
    return values[0];
  }

  return null;
}


export default function AssetDetailPanel({
  rows,
  getIdentifier,
  getHeaderLabel,
  formatValue,
}: AssetDetailPanelProps) {
  if (
    rows.length === 0
  ) {
    return (
      <aside className="details">

        <div className="dock-title">
          Detailansicht
        </div>


        <div className="details-content">

          <h2>
            Kein Asset ausgewählt
          </h2>

          <p>
            Wähle ein Asset in der Tabelle aus,
            um Details anzuzeigen.
          </p>

          <div className="detail-card">
            Keine Details verfügbar.
          </div>

        </div>

      </aside>
    );
  }


  if (
    rows.length === 1
  ) {
    const row =
      rows[0];

    const details =
      GENERAL_FIELDS
        .filter(
          (field) =>
            !isEmpty(
              row[field],
            ),
        );

    const specificationFields =
      Object.keys(
        row,
      ).filter(
        (field) =>
          field.startsWith(
            "spec_",
          ),
      );

    const labelsValue =
      row[
        "_specification_labels"
      ];

    const specificationLabels =
      (
        typeof labelsValue === "object"
        && labelsValue !== null
        && !Array.isArray(
          labelsValue,
        )
      )
        ? labelsValue as Record<
            string,
            unknown
          >
        : {};


    return (
      <aside className="details">

        <div className="dock-title">
          Detailansicht
        </div>


        <div className="details-content">

          <h2>
            {
              getIdentifier(
                row,
              )
            }
          </h2>


          <p>
            {
              [
                row.product_model_name,
                row.product_category_name,
              ]
                .filter(
                  (value) =>
                    !isEmpty(
                      value,
                    ),
                )
                .map(
                  String,
                )
                .join(" · ")
            }
          </p>


          <div className="detail-card">

            <h3>
              Allgemein
            </h3>


            {
              details.map(
                (field) => (
                  <div
                    className="detail-row"
                    key={field}
                  >

                    <span>
                      {
                        getHeaderLabel(
                          field,
                        )
                      }
                    </span>

                    <strong>
                      {
                        formatValue(
                          field,
                          row[field],
                        )
                      }
                    </strong>

                  </div>
                ),
              )
            }

          </div>


          <div className="detail-card">

            <h3>
              Spezifikationen
            </h3>


            {
              specificationFields.length === 0
                ? (
                  <div className="detail-info">
                    Für diese Produktkategorie
                    sind keine Spezifikationen vorhanden.
                  </div>
                )
                : specificationFields.map(
                    (field) => {
                      const configuredLabel =
                        specificationLabels[
                          field
                        ];

                      const label =
                        typeof configuredLabel === "string"
                        && configuredLabel.trim()
                          ? configuredLabel
                          : field
                              .slice(5)
                              .replaceAll(
                                "_",
                                " ",
                              );

                      return (
                        <div
                          className="detail-row"
                          key={field}
                        >

                          <span>
                            {label}
                          </span>

                          <strong>
                            {
                              isEmpty(
                                row[field],
                              )
                                ? "Keine"
                                : formatValue(
                                    field,
                                    row[field],
                                  )
                            }
                          </strong>

                        </div>
                      );
                    },
                  )
            }

          </div>

        </div>

      </aside>
    );
  }


  const commonFields =
    GENERAL_FIELDS
      .map(
        (field) => ({
          field,
          value:
            commonValue(
              rows,
              field,
            ),
        }),
      )
      .filter(
        (entry) =>
          entry.value !== null,
      );


  return (
    <aside className="details">

      <div className="dock-title">
        Detailansicht
      </div>


      <div className="details-content">

        <h2>
          {rows.length} Einträge ausgewählt
        </h2>


        <p>
          Gemeinsame Werte werden angezeigt.
        </p>


        <div className="detail-card">

          <h3>
            Allgemein
          </h3>


          {
            commonFields.length === 0
              ? (
                <div className="detail-info">
                  Keine gemeinsamen Werte vorhanden.
                </div>
              )
              : commonFields.map(
                  (entry) => (
                    <div
                      className="detail-row"
                      key={entry.field}
                    >

                      <span>
                        {
                          getHeaderLabel(
                            entry.field,
                          )
                        }
                      </span>

                      <strong>
                        {
                          formatValue(
                            entry.field,
                            entry.value,
                          )
                        }
                      </strong>

                    </div>
                  ),
                )
          }

        </div>

      </div>

    </aside>
  );
}