# ITAssetFlow

ITAssetFlow is a web-based application for managing IT inventory, stock levels, and material movements.

The project was developed as part of my TEKO diploma thesis **“IT Inventory Process Optimization”** at **DLC-Informatik GmbH**. Its goal is to make the existing inventory and stock management more transparent, traceable, and efficient.

The web application is the main version of ITAssetFlow. A native desktop application built with PySide6 is also available. It is intended as an optional alternative for a specific use case, rather than a second primary solution.

---

## Contents

- [Project Goal](#project-goal)
- [Features](#features)
- [Architecture](#architecture)
- [Deployment Overview](#deployment-overview)
- [Online Demo on Render](#online-demo-on-render)
- [Local Web Server for Testing](#local-web-server-for-testing)
- [Production Deployment with IIS](#production-deployment-with-iis)
- [GitHub Branches and Releases](#github-branches-and-releases)
- [Technologies](#technologies)
- [User Roles and Security](#user-roles-and-security)
- [Data Model](#data-model)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Development Environment](#development-environment)
- [Rebuilding the Frontend](#rebuilding-the-frontend)
- [Optional Desktop Application](#optional-desktop-application)
- [Demo Database](#demo-database)
- [Testing and Acceptance](#testing-and-acceptance)
- [Scope](#scope)
- [Diploma Thesis Context](#diploma-thesis-context)

---

# Project Goal

The diploma thesis starts with the existing management and storage of IT inventory at DLC-Informatik GmbH.

This includes, among other things:

- Notebooks and computers
- Monitors
- Printers
- Point-of-sale systems
- Network devices
- Computer components
- Cables and adapters
- Spare parts
- Installation materials and consumables
- Licenses and software data


The software is therefore one part of the overall process optimization, rather than the sole outcome of the diploma thesis.

---

# Features

ITAssetFlow distinguishes between individually inventoried devices and quantity-based stock items.

## Individual Devices

Individual devices are recorded separately and can be tracked individually.



Depending on the device, the following information can be stored, among other things:

- Manufacturer
- Product model
- Category
- Serial number
- Inventory number
- Technical specifications
- Site
- Department
- Storage location
- Assignment
- Status

## Quantity-Based Items

Quantity-based items are managed through stock movements.

Examples:

- Network cables
- Adapters
- SSDs
- RAM modules
- Spare parts
- Consumables
- Installation materials

## Additional Features

The current project includes, among other things:

- User login
- Inventory overview
- Search and filtering
- Configurable table views
- Detail view
- Creating and editing inventory entries
- Deleting inventory entries
- Managing manufacturers
- Managing categories
- Managing product models
- Category-specific technical specifications
- Managing the organization, sites, departments, and storage locations
- Stock movements
- Stock overviews
- CSV and PostgreSQL import and export
- Settings
- Multi-user operation
- Role-based access control

---

# Architecture

The application consists of several layers.

```text
                         ┌─────────────────────┐
                         │      Supabase       │
                         │ Auth / PostgREST    │
                         │     PostgreSQL      │
                         └──────────┬──────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │                             │
                     │                             │
          ┌──────────▼──────────┐       ┌──────────▼──────────┐
          │   Native Desktop    │       │      FastAPI        │
          │ Python / PySide6    │       │    Web Backend      │
          └─────────────────────┘       └──────────┬──────────┘
                                                   │
                                        ┌──────────▼──────────┐
                                        │      React          │
                                        │    Web Frontend     │
                                        └─────────────────────┘
```

The desktop application accesses the data directly through an authenticated Supabase client.

The web application follows this path:

```text
Browser
   ↓
React
   ↓
FastAPI
   ↓
Supabase
   ↓
PostgreSQL
```

The web application is the main version of the project.

The native desktop application remains available as an optional alternative and uses the same central database.

---

# Deployment Overview

ITAssetFlow can be run in three ways. Separate options are used for development, demos, and production.

| Option | Purpose | Frontend | Backend |
|---|---|---|---|
| **Render demo** | Public diploma thesis demo | `web/dist` is served by FastAPI | FastAPI on Render |
| **Local web server** | Quick test of a release package | `web/dist` is served by FastAPI | `Webserver_localhost.bat` / `src/web_main.py` |
| **Production web server** | Internal company use | IIS serves `web/dist` | `web_backend.cmd` / `src/web_main.py` |

The `web/dist` folder is a **generated build artifact**. It is therefore not part of the normal development state on the `main` branch. It is built and included specifically for deployment on Render and for GitHub releases.

---

# Online Demo on Render

A separate demo instance on **Render** is available for the diploma thesis presentation and external testing.

## Demo URL

```text
https://itassetflow-demo.onrender.com
```

The demo is entirely separate from the production environment of DLC-Informatik GmbH. It uses its own Supabase database, its own demo users, and test or demo data only.


On Render, FastAPI also serves the finished React frontend. The Render configuration enables standalone mode, among other settings:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=true
ITASSETFLOW_CORS_ORIGINS=https://itassetflow-demo.onrender.com
```

The Supabase values required by Render are maintained as environment variables in the Render service and are not stored in the repository.

## `webapp` Branch

The **`webapp`** branch is used exclusively for deployment on Render.

---

# Local Web Server for Testing

A GitHub release already contains the built `web/dist` folder. The web application can therefore be tested locally without installing Node.js, npm, or Vite.

To start it, use:

```text
Webserver_localhost.bat
```

## Requirements

You need:

- Python 3
- The packages in `requirements.txt`
- A valid `.env`, e.g. based on `.env_example`
- The `web/dist` folder included in the release

The Python dependencies can be installed once:

```powershell
python -m pip install -r requirements.txt
```

## Local Configuration

For a local standalone test, FastAPI must serve the React build as well as the API:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=false
```

Valid Supabase values are also required.

## Start

The file can be started by double-clicking it:

```text
Webserver_localhost.bat
```

Alternatively, the backend can be started directly:

```powershell
python src/web_main.py
```

The local web application is then available at:

```text
http://127.0.0.1:8000/#/login
```

The API status can be checked separately at:

```text
http://127.0.0.1:8000/api/health
```

This option is intended for functional tests, demonstrations, and checking a release package. IIS is used for ongoing company operations.

---

# Production Deployment with IIS



## 1. Use the Release

The finished release package is used on the company server. It contains this folder:

```text
web/dist/
```

The folder is already built. Therefore, **Node.js, npm, and Vite are not required** on the target server.

## 2. Serve the Frontend through IIS

IIS can point directly to the included build, for example:

```text
C:\ITAssetFlow\web\dist
```

Alternatively, the contents of `web/dist` can be copied into an existing IIS web directory.

The folder typically contains:

```text
web/dist/
├── index.html
└── assets/
    ├── *.js
    └── *.css
```

## 3. Prepare the Backend

The backend requires Python and the packages in:

```text
requirements.txt
```

Installation:

```powershell
python -m pip install -r requirements.txt
```

A production `.env` must also be present on the server. For security reasons, this file is **not included in the GitHub release**.

For IIS operation, FastAPI is used only as an API:

```env
ITASSETFLOW_SERVE_WEB=false
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
```

`ITASSETFLOW_COOKIE_SECURE` and `ITASSETFLOW_CORS_ORIGINS` must be set to match the actual internal HTTP/HTTPS configuration.

## 4. Start the Backend

The release includes the following file for a manual start:

```text
web_backend.cmd
```

It starts:

```text
src/web_main.py
```

Alternatively, the backend can be started directly:

```powershell
python src/web_main.py
```

For example, the API status can be checked at:

```text
http://localhost:8000/api/health
```

This endpoint can be used to verify that the API is responding.

## 5. Run Continuously as a Windows Service

For production use, the backend should not run permanently in an open CMD window.

---


## GitHub Release

For a release, a new production build is created from the current state of `main` and packaged as a ZIP together with the files needed to run it.

The release package must not include:

```text
.env
web/node_modules/
__pycache__/
*.pyc
.git/
```

The React development environment, including `web/src`, `node_modules`, and the TypeScript/Vite configuration files, is also unnecessary for simply running the release package. The full frontend source code remains available in the repository on the `main` branch.

### Important When Downloading


To test the application directly, use the provided release ZIP, for example:

```text
ITAssetFlow-v1.0..zip
```

This package already includes the finished `web/dist` build.

---

# Technologies

## Web Frontend

- React
- TypeScript
- Vite
- React Router
- CSS

## Backend

- Python
- FastAPI
- Uvicorn

## Database and API

- Supabase
- PostgreSQL
- PostgREST

## Authentication and Permissions

- Supabase Auth
- PostgreSQL Row Level Security
- Database functions
- Trigger
- Views

## Optional Desktop Version

- Python
- PySide6
- PyInstaller

## Deployment

- Microsoft IIS
- Windows Server
- Render for the public demo instance

---

# User Roles and Security

ITAssetFlow uses three application roles.

| Role | Database value | Purpose |
|---|---|---|
| Administrator | `admin` | Administrative and full editing rights |
| Editor | `user` | Read and edit inventory data |
| Viewer | `viewer` | Read-only access |

Authentication is handled by Supabase Auth.

The connection between an authenticated user and an employee record is established through `employees.auth_user_id`.

```text
Supabase Auth
     │
     ▼
auth.users
     │
     │ auth_user_id
     ▼
public.employees
     │
     │ app_role
     ▼
Row Level Security
```

Permissions are not checked only in the user interface.

The database additionally protects the relevant tables using Row Level Security.

The helper functions used include:

```text
private.current_app_role()
private.is_admin()
private.can_read_inventory()
private.can_edit_inventory()
```

## Security Principles

- Do not commit `.env` to Git
- Do not store database passwords in the source code
- Do not store user passwords in the source code
- Do not use Supabase service role keys in the React frontend
- Secure user access with Supabase Auth
- Secure database access with RLS
- Use HTTPS for regular web operation
- Limit firewall access to the necessary network

The Supabase publishable key is intended for client applications. Actual access control is provided by authentication and RLS.

---

# Data Model

The database is divided into several logical areas.

## Organization and Storage Structure

```text
Organization
    │
    ▼
Site
    │
    ├── Department
    │
    └── Storage location
```

Key tables:

```text
organizations
sites
departments
site_departments
storage_locations
employees
```

## Manufacturers and Product Data

```text
Manufacturer ────┐
                  ├── Product model
Category ────────┘
     │
     └── Specification schema
```

Key tables:

```text
manufacturers
product_categories
product_models
```

Product categories can contain a specification schema.

This makes it possible to define different technical attributes for each category.

Product models store the corresponding specific specifications.

## Inventory

Key tables:

```text
assets
asset_locations
asset_assignments
asset_component_assignments
```

This makes it possible to track devices, sites, and assignments.

## Stock

Key tables:

```text
stock_movements
stock_counts
stock_targets
```

Views are also available for stock information:

```text
stock_levels
stock_levels_total
```

Stock levels can therefore be traced back to the recorded material movements.

## Software Management

The database also contains tables for:

```text
software_products
software_licenses
software_installations
```

## Additional Technical Tables

```text
audit_log
inventory_change_state
connection_test
```

---

# Project Structure

The following structure shows the development state on the **`main` branch**.

Generated folders such as `__pycache__`, `node_modules`, and `web/dist` are deliberately omitted from the actual source code structure.

```text
ITAssetFlow/
│
├── src/
│   ├── infrastructure/
│   ├── ui/
│   │
│   ├── web_backend/
│   │   ├── routes/
│   │   ├── __init__.py
│   │   ├── app.py
│   │   ├── dependencies.py
│   │   └── settings_routes.py
│   │
│   ├── config.py
│   ├── inventory.py
│   ├── logging_config.py
│   ├── main.py
│   ├── settings_manager.py
│   └── web_main.py
│
├── web/
│   ├── public/
│   │
│   ├── src/
│   │   ├── api/
│   │   ├── assets/
│   │   │
│   │   ├── components/
│   │   │   ├── AboutDialog.tsx
│   │   │   ├── AssetDetailPanel.tsx
│   │   │   ├── InventorySidebar.tsx
│   │   │   ├── InventoryTable.tsx
│   │   │   └── MainMenu.tsx
│   │   │
│   │   ├── hooks/
│   │   │
│   │   ├── pages/
│   │   │   ├── AboutPage.tsx
│   │   │   ├── AssetFormPage.css
│   │   │   ├── AssetFormPage.tsx
│   │   │   ├── InventoryPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── SettingsPage.css
│   │   │   └── SettingsPage.tsx
│   │   │
│   │   ├── types/
│   │   ├── utils/
│   │   ├── App.css
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   │
│   ├── eslint.config.js
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── tsconfig.app.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
│
├── .env.example
├── .gitignore
├── ITAssetFlow.spec
├── README.md
├── requirements.txt
├── Webserver_localhost.bat
└── web_backend.cmd
```

## Generated Production Build

After running

```powershell
cd web
npm.cmd ci
npm.cmd run build
```

the following is also generated:

```text
web/
└── dist/
    ├── index.html
    └── assets/
```

## Key Entry Points

| File | Purpose |
|---|---|
| `src/web_main.py` | Starts the FastAPI web backend |
| `web/src/main.tsx` | Entry point of the React frontend |
| `src/main.py` | Starts the optional desktop application |
| `Webserver_localhost.bat` | Local standalone test using the finished `web/dist` build |
| `web_backend.cmd` | Manual start of the backend for IIS / a production web server |
| `.env` | Local or server-specific configuration; not stored in Git |
| `.env.example` | Configuration template |
| `ITAssetFlow.spec` | PyInstaller configuration for the optional desktop application |

---

# Configuration

ITAssetFlow uses a `.env` file for environment-specific settings.

The real `.env` must not be committed to Git or included in a public release.

The basic settings required are:

```env
SUPABASE_URL=https://example.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key

ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
```

## Local Standalone Test

For local testing, FastAPI also serves the React frontend:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=false
```

## IIS / Production Web Server

In the company environment, IIS serves the frontend. FastAPI provides only the API:

```env
ITASSETFLOW_SERVE_WEB=false
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
```

The allowed browser origin must also be set to match the internal address, for example:

```env
ITASSETFLOW_CORS_ORIGINS=http://ITAssetFlow.dlc-informatik.local
```

For a setup running entirely over HTTPS, the configuration must be adjusted accordingly and `ITASSETFLOW_COOKIE_SECURE=true` must be set.

## Render Demo

Render uses its own environment variables. The demo uses a separate Supabase instance and, among other settings:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=true
ITASSETFLOW_CORS_ORIGINS=https://itassetflow-demo.onrender.com
```

## Supabase Connection

The publishable key used is intended for client/application access. Actual access control is additionally enforced through Supabase Auth and Row Level Security.

Do not store the following in the client or repository:

- Database password
- Service role key
- User passwords



---

# Development Environment

Python, Node.js, and npm are required for further development.

## Python Dependencies

If missing, these are installed automatically at startup from requirements.txt. Alternatively, they can be installed manually in the project directory:

```powershell
python -m pip install -r requirements.txt
```

## Frontend Dependencies

```powershell
cd web
npm.cmd ci
cd ..
```

`npm.cmd ci` uses the existing `package-lock.json`.

## Development Mode

```powershell
python src/web_main.py --dev
```

Development mode also uses the Vite development server.

Typical local address:

```text
http://127.0.0.1:5173
```

This mode is intended for development.

---

# Rebuilding the Frontend

After changes to the React frontend, a new production build must be created.

```powershell
cd web
npm.cmd ci
npm.cmd run build
```

The new build is then located in:

```text
web/dist/
```

This folder is not stored on the **`main` branch**.
It is used only on the `webapp` branch for Render, where a finished production build is required.

If a special Render build was created earlier, make sure that no Render-specific `VITE_API_BASE_URL` remains set in the local build environment before creating the company/release build.

---

# Optional Desktop Application

In addition to the web application, a native PySide6 client is available.
This application is not the main solution of the diploma thesis.

It remains available as an optional alternative if a native Windows client is needed for a specific use case.

Start:

```powershell
python src/main.py
```

The PyInstaller configuration is available for a Windows build:

```text
ITAssetFlow.spec
```

The desktop application uses the same Supabase database and the same server-side permission rules.

---

# Demo Database

A separate Supabase database is used for the diploma thesis presentation and the public demo.

The demo environment is separate from the production database and has its own test users and demo data.
This allows ITAssetFlow to be demonstrated realistically without changing the production environment.

Non-sensitive master data can be copied, such as:

- Organization
- Sites
- Departments
- Storage locations
- Manufacturers
- Product categories
- Specification definitions
- Product models
- Technical specifications

The following are not copied:

- Production user passwords
- Real authentication sessions
- Confidential employee data
- Real device assignments
- Real stock movements
- Personal or other sensitive operational data

---

# Testing and Acceptance

## Roles

### Administrator

The administrator has the broadest permissions and can use administrative functions.

### Editor

The editor can read inventory data and edit the data as intended.

### Viewer

The viewer has read-only access.
Write access for this role must be blocked on the server side by RLS.

# Traceability

A central goal of ITAssetFlow is to store the current state while also making changes and movements easier to trace.

This includes tracking where a device was located, to whom it was assigned, when material was moved, how a stock level came about, and which relevant changes were made.

This includes, among other things:

```text
asset_locations
asset_assignments
asset_component_assignments
stock_movements
audit_log
```



---

# Scope

The project is not intended to replace a complete ERP system, inventory management system, IT service management system,
or procurement system. The web application is the primary end product.

The focus is on:

- IT inventory
- Stock levels
- Material movements
- Centralized data storage
- Roles and permissions
- Multi-user operation
- Ease of use

---

# Diploma Thesis Context

The project is part of the TEKO diploma thesis:

**IT Inventory Process Optimization**

**Candidate:** Sven Döring  
**Education:** Dipl. Informatiker HF, specialization in Systems Engineering  
**Class:** S-TIP-23-Di-z  
**Company:** DLC-Informatik GmbH

The material management department / warehouse of DLC-Informatik GmbH was defined as the internal customer.
The solution is intended to help:

- Save resources
- Reduce time and costs
- Improve the traceability of material movements
- Improve the stock overview
- Support the planning of material purchases


---


## Releases

The GitHub release includes a separately created ZIP package. It contains the finished `web/dist` folder and the startup files for local testing and IIS/backend operation.

Alternatively, a demo version of the database can be viewed on Render:
https://itassetflow-demo.onrender.com/#/

---

# Usage

The project is intended for internal use by DLC-Informatik GmbH and for educational and diploma thesis purposes.

No further public licensing or distribution terms have been specified.
