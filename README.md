# AssetFlow IT

AssetFlow IT is a desktop application for managing IT inventory, warehouse stock, and material movements.

The application provides a centralized solution for managing IT equipment such as computers, laptops, monitors, printers, POS systems, network devices, peripherals, spare parts, and other IT-related materials.

## Goal

The goal of AssetFlow IT is to simplify and improve the management of IT inventory and warehouse processes.

The application is designed to provide:

- Centralized inventory management
- Clear overview of available IT equipment and stock
- Assignment of assets to departments and locations
- Tracking of asset and material movements
- Management of individually tracked devices and quantity-based stock items
- Structured technical specifications for different product categories
- Multi-user access through a central database

## Features

Current and planned features include:

- IT asset overview
- Product categories and product models
- Manufacturer management
- Department and location assignment
- Hierarchical storage locations
- Warehouse stock management
- Stock movements
- Inventory counts
- Minimum and target stock levels
- Asset-specific technical specifications
- Product-specific technical specifications
- Software and license management
- User authentication and role management
- Search and filtering
- Configurable table columns
- Dockable navigation and detail views

## Application Overview

<!--
Diagram / architecture image will be added here later.

Example:
PySide6 Desktop Client
        |
        v
Supabase Auth / API
        |
        v
PostgreSQL
  |-- Assets
  |-- Product Catalog
  |-- Warehouse / Stock
  |-- Departments / Locations
  `-- Software / Licenses
-->


## Technologies

AssetFlow IT is built with:

- **Python** – application logic
- **PySide6** – desktop user interface
- **Supabase** – backend services and authentication
- **PostgreSQL** – relational database
- **PostgREST** – database access through Supabase

## Architecture

The application follows a client-server architecture.

The PySide6 desktop application acts as the client and communicates with Supabase. Supabase provides authentication and access to the PostgreSQL database.

The database separates individually tracked assets from quantity-based warehouse stock.

Examples:

- Computers, laptops, monitors, and printers can be tracked individually using asset tags and serial numbers.
- CPUs, RAM modules, SSDs, cables, and other stock materials can be managed using quantities and stock movements.

Technical specifications are defined according to the product category. This allows different types of equipment to store different information, for example:

- **Computer:** CPU, RAM, storage, GPU, operating system
- **Monitor:** screen size, resolution, panel type, refresh rate, connections
- **Network switch:** port count, port speed, PoE, SFP ports

## Code Structure

The project is separated into user interface, infrastructure, and shared inventory logic.

```text
AssetFlow-IT/
├── README.md
├── requirements.txt
├── .env
│
└── src/
    ├── main.py
    ├── inventory.py
    ├── settings_manager.py
    │
    ├── ui/
    │   ├── main_window.py
    │   ├── asset_table_widget.py
    │   ├── inventory_sidebar.py
    │   ├── asset_detail_sidebar.py
    │   └── theme.py
    │
    └── infrastructure/
        ├── supabase_client.py
        ├── asset_repository.py
        └── inventory_change_monitor.py
```

### Main Modules

**`main.py`**  
Application entry point. Initializes the Supabase client, authentication, and the main window.

**`inventory.py`**  
Contains shared inventory logic, labels, category mappings, formatting functions, and specification helpers.

**`ui/main_window.py`**  
Main application window. Coordinates the inventory table, navigation sidebar, detail sidebar, menus, filtering, and refresh logic.

**`ui/asset_table_widget.py`**  
Displays the inventory data in the central table and manages sorting, column visibility, selection, and search behavior.

**`ui/inventory_sidebar.py`**  
Provides inventory search, inventory-type filters, product-category filters, and asset actions.

**`ui/asset_detail_sidebar.py`**  
Displays detailed information about the selected asset. Product-specific specifications such as CPU, RAM, screen size, resolution, or ports are shown dynamically based on the product category.

When multiple assets are selected, only values that are identical across all selected assets are displayed.

**`infrastructure/supabase_client.py`**  
Creates and manages the shared Supabase client and handles authentication-related access.

**`infrastructure/asset_repository.py`**  
Loads data from Supabase and combines assets with product models, categories, manufacturers, departments, locations, and specifications.

**`infrastructure/inventory_change_monitor.py`**  
Checks for inventory changes and triggers automatic refreshes of the application.

**`settings_manager.py`**  
Stores and restores local application settings such as window size and window state.

## Requirements

The main Python dependencies are:

```txt
PySide6
supabase
python-dotenv
```

Install the dependencies with:

```bash
pip install -r requirements.txt
```

## Configuration

AssetFlow IT uses environment variables for the Supabase connection.

Create a `.env` file in the project directory and configure the required Supabase values.

Example:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_PUBLISHABLE_KEY=your_supabase_key
```

Development authentication can additionally use:

```env
SUPABASE_DEV_EMAIL=your_development_user
SUPABASE_DEV_PASSWORD=your_development_password
```

Do not commit the `.env` file to the repository.

## Run

Start the application with:

```bash
python src/main.py
```

## Project Status

AssetFlow IT is currently under active development.

The core database structure, Supabase integration, authentication, inventory overview, filtering, asset detail views, and product-specific specification logic are being developed and refined.

Additional functionality such as creating and editing assets, warehouse operations, and extended inventory workflows will be added progressively.

## License

This project is currently intended for internal and educational use.
