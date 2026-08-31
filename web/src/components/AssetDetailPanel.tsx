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


const GENERAL_DETAIL_FIELDS = [
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


const SPECIFICATION_PREFIX =
  "spec_";


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

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.length === 0;
  }

  if (
    typeof value === "object"
  ) {
    return (
      Object.keys(
        value,
      ).length === 0
    );
  }

  return false;
}


function normalizedValue(
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
        Object.keys(
          value,
        ).sort(),
      );
    } catch {
      return String(
        value,
      );
    }
  }

  return String(
    value,
  );
}


function commonNonEmptyValue(
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
    values[0];

  const normalized =
    normalizedValue(
      first,
    );

  if (
    values
      .slice(1)
      .every(
        (value) =>
          normalizedValue(
            value,
          ) === normalized,
      )
  ) {
    return first;
  }

  return null;
}


function sumNewPrices(
  rows: InventoryRow[],
): number | null {
  let total = 0;
  let found = false;

  for (
    const row
    of rows
  ) {
    const value =
      row.new_price;

    if (
      isEmpty(
        value,
      )
    ) {
      continue;
    }

    const amount =
      Number(
        value,
      );

    if (
      !Number.isFinite(
        amount,
      )
    ) {
      return null;
    }

    total +=
      amount;

    found = true;
  }

  return found
    ? total
    : null;
}


function formatChf(
  value: unknown,
): string {
  const amount =
    Number(
      value,
    );

  if (
    !Number.isFinite(
      amount,
    )
  ) {
    return String(
      value ?? "",
    );
  }

  const negative =
    amount < 0;

  const rounded =
    Math.round(
      Math.abs(amount) * 100,
    );

  const integer =
    Math.floor(
      rounded / 100,
    );

  const cents =
    rounded % 100;

  const integerText =
    String(
      integer,
    ).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      "'",
    );

  const prefix =
    negative
      ? "-"
      : "";

  if (
    cents === 0
  ) {
    return (
      `CHF ${prefix}${integerText}.-`
    );
  }

  return (
    `CHF ${prefix}${integerText}.`
    + String(
      cents,
    ).padStart(
      2,
      "0",
    )
  );
}


function formatDate(
  value: unknown,
): string {
  const text =
    String(
      value ?? "",
    ).trim();

  if (!text) {
    return "";
  }

  const datePart =
    text.slice(
      0,
      10,
    );

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/
      .exec(
        datePart,
      );

  if (!match) {
    return text;
  }

  return (
    `${match[3]}-${match[2]}-${match[1]}`
  );
}


function specificationLabel(
  row: InventoryRow,
  field: string,
): string {
  const labels =
    row._specification_labels;

  if (
    typeof labels === "object"
    && labels !== null
    && !Array.isArray(
      labels,
    )
  ) {
    const value =
      (
        labels as Record<
          string,
          unknown
        >
      )[field];

    if (
      value !== null
      && value !== undefined
      && String(value).trim()
    ) {
      return String(
        value,
      ).trim();
    }
  }

  return field
    .slice(
      SPECIFICATION_PREFIX.length,
    )
    .replaceAll(
      "_",
      " ",
    )
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase(),
    );
}


function DetailRows({
  rows,
}: {
  rows: Array<{
    label: string;
    value: string;
    emphasized?: boolean;
  }>;
}) {
  if (
    rows.length === 0
  ) {
    return null;
  }

  return (
    <div className="detail-card">

      <h3>
        Allgemein
      </h3>


      {
        rows.map(
          (
            row,
            index,
          ) => (
            <div
              className={
                row.emphasized
                  ? "detail-row detail-row-emphasized"
                  : "detail-row"
              }
              key={
                `${row.label}:${index}`
              }
            >

              <span>
                {row.label}
              </span>

              <strong>
                {row.value}
              </strong>

            </div>
          ),
        )
      }

    </div>
  );
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
            Kein Eintrag ausgewählt
          </h2>

          <p>
            Wähle einen oder mehrere Einträge in der Tabelle aus,
            um Details anzuzeigen.
          </p>

          <div className="detail-card">
            <div className="detail-info">
              Keine Details verfügbar.
            </div>
          </div>

        </div>

      </aside>
    );
  }


  const multiple =
    rows.length > 1;


  const generalRows:
    Array<{
      label: string;
      value: string;
      emphasized?: boolean;
    }> = [];


  for (
    const field
    of GENERAL_DETAIL_FIELDS
  ) {
    if (
      multiple
      && field === "new_price"
    ) {
      const total =
        sumNewPrices(
          rows,
        );

      if (
        total !== null
      ) {
        generalRows.push({
          label:
            getHeaderLabel(
              field,
            ),
          value:
            formatChf(
              total,
            ),
          emphasized:
            true,
        });
      }

      continue;
    }


    const value =
      multiple
        ? commonNonEmptyValue(
            rows,
            field,
          )
        : rows[0][field];


    if (
      isEmpty(
        value,
      )
    ) {
      continue;
    }


    let formatted =
      "";

    if (
      field === "new_price"
    ) {
      formatted =
        formatChf(
          value,
        );
    } else if (
      field === "purchase_date"
      || field === "warranty_until"
    ) {
      formatted =
        formatDate(
          value,
        );
    } else {
      formatted =
        formatValue(
          field,
          value,
        );
    }


    generalRows.push({
      label:
        getHeaderLabel(
          field,
        ),
      value:
        formatted,
      emphasized:
        field === "new_price",
    });
  }


  const specificationFields =
    multiple
      ? (
        rows[0]
          ? Object.keys(
              rows[0],
            ).filter(
              (field) =>
                field.startsWith(
                  SPECIFICATION_PREFIX,
                )
                && rows.every(
                  (row) =>
                    field in row,
                ),
            )
          : []
      )
      : Object.keys(
          rows[0],
        ).filter(
          (field) =>
            field.startsWith(
              SPECIFICATION_PREFIX,
            ),
        );


  const specificationRows =
    specificationFields
      .map(
        (field) => {
          const value =
            multiple
              ? commonNonEmptyValue(
                  rows,
                  field,
                )
              : rows[0][field];

          if (
            multiple
            && value === null
          ) {
            return null;
          }

          return {
            field,
            label:
              specificationLabel(
                rows[0],
                field,
              ),
            value:
              isEmpty(
                value,
              )
                ? "Keine"
                : formatValue(
                    field,
                    value,
                  ),
          };
        },
      )
      .filter(
        (
          row,
        ): row is {
          field: string;
          label: string;
          value: string;
        } =>
          row !== null,
      );


  const title =
    multiple
      ? `${rows.length} Einträge ausgewählt`
      : getIdentifier(
          rows[0],
        );


  const hint =
    multiple
      ? (
        "Gemeinsame Werte werden angezeigt; "
        + "der Neupreis wird über die gesamte Auswahl summiert."
      )
      : [
          String(
            rows[0].product_model_name
            ?? "",
          ).trim(),

          String(
            rows[0].product_category_name
            ?? "",
          ).trim(),
        ]
          .filter(
            Boolean,
          )
          .join(
            " · ",
          )
          || "1 Eintrag ausgewählt";


  return (
    <aside className="details">

      <div className="dock-title">
        Detailansicht
      </div>


      <div className="details-content">

        <h2>
          {title}
        </h2>

        <p>
          {hint}
        </p>


        <DetailRows
          rows={
            generalRows
          }
        />


        <div className="detail-card">

          <h3>
            Spezifikationen
          </h3>


          {
            specificationRows.length > 0
              ? (
                specificationRows.map(
                  (row) => (
                    <div
                      className="detail-row"
                      key={
                        row.field
                      }
                    >

                      <span>
                        {row.label}
                      </span>

                      <strong>
                        {row.value}
                      </strong>

                    </div>
                  ),
                )
              )
              : (
                <div className="detail-info">
                  {
                    multiple
                      ? (
                        "Keine identischen Spezifikationswerte "
                        + "bei allen ausgewählten Einträgen vorhanden."
                      )
                      : (
                        "Für diese Produktkategorie ist noch kein "
                        + "Spezifikationsschema definiert."
                      )
                  }
                </div>
              )
          }

        </div>

      </div>

    </aside>
  );
}
