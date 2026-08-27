import {
  useEffect,
  useRef,
  useState,
} from "react";


export type FilterOption = {
  key: string;
  label: string;
};


export type InventoryFilterOptions = {
  groups: FilterOption[];
  categories: FilterOption[];
  conditions: FilterOption[];
  sites: FilterOption[];
  departments: FilterOption[];
  storageLocations: FilterOption[];
};


export type InventoryFilters = {
  groups: Set<string>;
  categories: Set<string>;
  conditions: Set<string>;
  sites: Set<string>;
  departments: Set<string>;
  storageLocations: Set<string>;
};


type MultiSelectDropdownProps = {
  placeholder: string;
  options: FilterOption[];
  selected: Set<string>;

  onChange: (
    selection: Set<string>,
  ) => void;
};


function MultiSelectDropdown({
  placeholder,
  options,
  selected,
  onChange,
}: MultiSelectDropdownProps) {
  const [
    open,
    setOpen,
  ] = useState(false);

  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    );


  useEffect(
    () => {
      function closeOutside(
        event: MouseEvent,
      ): void {
        if (
          rootRef.current
          && !rootRef.current.contains(
            event.target as Node,
          )
        ) {
          setOpen(
            false,
          );
        }
      }

      document.addEventListener(
        "mousedown",
        closeOutside,
      );

      return () => {
        document.removeEventListener(
          "mousedown",
          closeOutside,
        );
      };
    },
    [],
  );


  function buttonText(): string {
    if (
      selected.size === 0
    ) {
      return placeholder;
    }

    const selectedLabels =
      options
        .filter(
          (option) =>
            selected.has(
              option.key,
            ),
        )
        .map(
          (option) =>
            option.label,
        );

    if (
      selectedLabels.length === 1
    ) {
      return selectedLabels[0];
    }

    if (
      selectedLabels.length === 2
    ) {
      return selectedLabels.join(
        " · ",
      );
    }

    return `${selectedLabels.length} ausgewählt`;
  }


  function toggle(
    key: string,
  ): void {
    const next =
      new Set(
        selected,
      );

    if (
      next.has(key)
    ) {
      next.delete(
        key,
      );
    } else {
      next.add(
        key,
      );
    }

    onChange(
      next,
    );
  }


  if (
    options.length === 0
  ) {
    return (
      <button
        type="button"
        className="filter-dropdown-button"
        disabled
      >
        Keine Daten verfügbar
      </button>
    );
  }


  return (
    <div
      className="filter-dropdown"
      ref={rootRef}
    >

      <button
        type="button"
        className="filter-dropdown-button"
        onClick={() =>
          setOpen(
            (current) =>
              !current,
          )
        }
      >
        <span>
          {buttonText()}
        </span>

        <span className="dropdown-arrow">
          ▾
        </span>
      </button>


      {
        open
        && (
          <div className="filter-dropdown-menu">

            <button
              type="button"
              className="filter-clear-button"
              onClick={() =>
                onChange(
                  new Set(),
                )
              }
            >
              Alle anzeigen
            </button>


            <div className="menu-separator" />


            {
              options.map(
                (option) => (
                  <label
                    className="filter-option"
                    key={option.key}
                  >

                    <input
                      type="checkbox"
                      checked={
                        selected.has(
                          option.key,
                        )
                      }
                      onChange={() =>
                        toggle(
                          option.key,
                        )
                      }
                    />

                    <span>
                      {option.label}
                    </span>

                  </label>
                ),
              )
            }

          </div>
        )
      }

    </div>
  );
}


type InventorySidebarProps = {
  search: string;

  filters: InventoryFilters;
  options: InventoryFilterOptions;

  loading: boolean;

  selectedIdentifiers: string[];
  countText: string;

  onSearchChange: (
    value: string,
  ) => void;

  onFiltersChange: (
    filters: InventoryFilters,
  ) => void;

  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
};


export default function InventorySidebar({
  search,
  filters,
  options,
  loading,
  selectedIdentifiers,
  countText,
  onSearchChange,
  onFiltersChange,
  onCreate,
  onEdit,
  onDelete,
}: InventorySidebarProps) {
  const selectionCount =
    selectedIdentifiers.length;


  function updateFilter(
    name: keyof InventoryFilters,
    value: Set<string>,
  ): void {
    onFiltersChange({
      ...filters,
      [name]: value,
    });
  }


  let selectionText =
    "Kein Eintrag ausgewählt";

  if (
    selectionCount === 1
  ) {
    selectionText =
      `Ausgewählter Eintrag:\n${selectedIdentifiers[0]}`;
  }

  if (
    selectionCount > 1
  ) {
    selectionText =
      `${selectionCount} Einträge ausgewählt`;
  }


  return (
    <aside className="navigation">

      <div className="dock-title">
        Navigation
      </div>


      <div className="navigation-content">

        <label
          className="sidebar-title"
          htmlFor="inventory-search"
        >
          Inventar durchsuchen
        </label>


        <input
          id="inventory-search"
          type="search"
          placeholder="Alle sichtbaren Spalten durchsuchen ..."
          value={search}
          disabled={loading}
          onChange={(event) =>
            onSearchChange(
              event.target.value,
            )
          }
        />


        <div className="sidebar-filter-list">

          <MultiSelectDropdown
            placeholder="Inventartyp"
            options={options.groups}
            selected={filters.groups}
            onChange={(value) =>
              updateFilter(
                "groups",
                value,
              )
            }
          />


          <MultiSelectDropdown
            placeholder="Kategorie"
            options={options.categories}
            selected={filters.categories}
            onChange={(value) =>
              updateFilter(
                "categories",
                value,
              )
            }
          />


          <MultiSelectDropdown
            placeholder="Zustand"
            options={options.conditions}
            selected={filters.conditions}
            onChange={(value) =>
              updateFilter(
                "conditions",
                value,
              )
            }
          />


          <MultiSelectDropdown
            placeholder="Standort"
            options={options.sites}
            selected={filters.sites}
            onChange={(value) =>
              updateFilter(
                "sites",
                value,
              )
            }
          />


          <MultiSelectDropdown
            placeholder="Abteilung"
            options={options.departments}
            selected={filters.departments}
            onChange={(value) =>
              updateFilter(
                "departments",
                value,
              )
            }
          />


          <MultiSelectDropdown
            placeholder="Lagerort"
            options={
              options.storageLocations
            }
            selected={
              filters.storageLocations
            }
            onChange={(value) =>
              updateFilter(
                "storageLocations",
                value,
              )
            }
          />

        </div>


        <div className="sidebar-actions">

          <label className="sidebar-title">
            Inventar
          </label>


          <button
            type="button"
            disabled={loading}
            onClick={onCreate}
          >
            Neuer Eintrag
          </button>


          <button
            type="button"
            disabled={
              loading
              || selectionCount !== 1
            }
            onClick={onEdit}
          >
            Eintrag bearbeiten
          </button>


          <button
            type="button"
            disabled={
              loading
              || selectionCount === 0
            }
            onClick={onDelete}
          >
            {
              selectionCount === 1
                ? "Eintrag löschen"
                : selectionCount > 1
                  ? `${selectionCount} Einträge löschen`
                  : "Einträge löschen"
            }
          </button>

        </div>


        <div className="sidebar-grow" />


        <label className="sidebar-title">
          Auswahl
        </label>


        <div className="selection-box">
          {selectionText}
        </div>


        <div className="sidebar-count">
          {countText}
        </div>

      </div>

    </aside>
  );
}