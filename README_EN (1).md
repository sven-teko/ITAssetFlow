**# ITAssetFlow**



ITAssetFlow is a web-based application for managing IT inventory, stock levels, and material movements.



The project was developed as part of my TEKO diploma thesis **\*\*“IT Inventory Process Optimization”\*\*** at **\*\*DLC-Informatik GmbH\*\***. The aim is to make the existing inventory and warehouse management more transparent, traceable, and efficient.



The web application is the main version of ITAssetFlow. In addition, a native desktop application using PySide6 exists. It is not intended as a second main solution, but as an optional alternative for a specific special use case.



**---**



**## Contents**



\- [Project Objective]\(#project-objective)

\- [Functionality]\(#functionality)

\- [Architecture]\(#architecture)

\- [Deployment Overview]\(#deployment-overview)

\- [Online Demo on Render]\(#online-demo-on-render)

\- [Local Web Server for Testing]\(#local-web-server-for-testing)

\- [Production Operation with IIS]\(#production-operation-with-iis)

\- [GitHub Branches and Releases]\(#github-branches-and-releases)

\- [Technologies]\(#technologies)

\- [User Roles and Security]\(#user-roles-and-security)

\- [Data Model]\(#data-model)

\- [Project Structure]\(#project-structure)

\- [Configuration]\(#configuration)

\- [Development Environment]\(#development-environment)

\- [Rebuild Frontend]\(#rebuild-frontend)

\- [Optional Desktop Application]\(#optional-desktop-application)

\- [Demo Database]\(#demo-database)

\- [Testing and Acceptance]\(#testing-and-acceptance)

\- [Scope]\(#scope)

\- [Diploma Thesis Context]\(#diploma-thesis-context)



**---**



**# Project Objective**



The starting point of the diploma thesis is the existing management and storage of the IT inventory at DLC-Informatik GmbH.



This includes, among other things:



\- Notebooks and computers

\- Monitors

\- Printers

\- Point-of-sale systems

\- Network devices

\- Computer components

\- Cables and adapters

\- Spare parts

\- Installation and consumable materials

\- Licenses and software data





The software is therefore one component of the overall process optimization and not the sole result of the diploma thesis.



**---**



**# Functionality**



ITAssetFlow distinguishes between individually inventoried devices and quantity-based stock items.



**## Individual Devices**



Individual devices are recorded separately and can be tracked individually.







Depending on the device, the following information can be stored, among other things:



\- Manufacturer

\- Product model

\- Category

\- Serial number

\- Inventory number

\- Technical specifications

\- Site

\- Department

\- Storage location

\- Assignment

\- Status



**## Quantity-Based Items**



Quantity-based items are managed through stock movements.



Examples:



\- Network cables

\- Adapters

\- SSDs

\- RAM modules

\- Spare parts

\- Consumable materials

\- Installation materials



**## Additional Functions**



The current project version includes, among other things:



\- User login

\- Inventory overview

\- Search and filtering

\- Configurable table views

\- Detail view

\- Creating and editing inventory entries

\- Deleting inventory entries

\- Manufacturer management

\- Category management

\- Product model management

\- Category-specific technical specifications

\- Management of organizations, sites, departments, and storage locations

\- Stock movements

\- Stock overviews

\- CSV and PostgreSQL import and export

\- Settings

\- Multi-user operation

\- Role-based access control



**---**



**# Architecture**



The application consists of several layers.



\`\`\`text

                         ┌─────────────────────┐

                         │      Supabase       │

                         │ Auth / PostgREST    │

                         │     PostgreSQL      │

                         └──────────┬──────────┘

                                    │

                     ┌──────────────┴──────────────┐

                     │                             │

                     │                             │

          ┌──────────▼──────────┐       ┌──────────▼──────────┐

          │   Native Desktop    │       │      FastAPI        │

          │ Python / PySide6    │       │    Web-Backend      │

          └─────────────────────┘       └──────────┬──────────┘

                                                   │

                                        ┌──────────▼──────────┐

                                        │      React          │

                                        │    Web Frontend     │

                                        └─────────────────────┘

\`\`\`



The desktop application accesses the data directly through an authenticated Supabase client.



The web application, on the other hand, uses the following path:



\`\`\`text

Browser

   ↓

React

   ↓

FastAPI

   ↓

Supabase

   ↓

PostgreSQL

\`\`\`



The web application is the main version of the project.



The native desktop application remains available as an optional alternative and uses the same central database.



**---**



**# Deployment Overview**



ITAssetFlow can be run in three different ways. Different variants are deliberately used for development, demo, and production operation.



\| Variant | Purpose | Frontend | Backend |

\|---|---|---|---|

\| **\*\*Render Demo\*\*** | public diploma thesis demo | \`web/dist\` is served via FastAPI | FastAPI on Render |

\| **\*\*Local Web Server\*\*** | quick testing of a release package | \`web/dist\` is served via FastAPI | \`Webserver_localhost.bat\` / \`src/web_main.py\` |

\| **\*\*Production Web Server\*\*** | internal company operation | IIS serves \`web/dist\` | \`web_backend.cmd\` / \`src/web_main.py\` |



The \`web/dist\` folder is a **\*\*generated build artifact\*\***. It is therefore not part of the normal development state in the \`main\` branch. It is specifically generated and included for Render deployment and GitHub releases.



**---**



**# Online Demo on Render**



A separate demo instance on **\*\*Render\*\*** is available for the diploma thesis presentation and for external testing.



**## Demo URL**



\`\`\`text

https\://itassetflow-demo.onrender.com

\`\`\`



The demo is completely separated from the production environment of DLC-Informatik GmbH. It uses its own Supabase database, its own demo users, and exclusively test or demo data.





On Render, FastAPI also serves the completed React frontend. For this purpose, standalone mode is enabled in the Render configuration, among other settings:



\`\`\`env

ITASSETFLOW_SERVE_WEB=true

ITASSETFLOW_COOKIE_SECURE=true

ITASSETFLOW_CORS_ORIGINS=https\://itassetflow-demo.onrender.com

\`\`\`



The Supabase values required for Render are maintained as environment variables in the Render service and are not stored in the repository.



**## Branch \`webapp\`**



The **\*\*\`webapp\`\*\*** branch is used exclusively for Render deployment.



**---**



**# Local Web Server for Testing**



A GitHub release already contains the built \`web/dist\` folder. This allows the web application to be tested locally without having to install Node.js, npm, or Vite.



The following file is used to start it:



\`\`\`text

Webserver_localhost.bat

\`\`\`



**## Requirements**



The following are required:



\- Python 3

\- The packages from \`requirements.txt\`

\- A valid \`.env\`, e.g. based on \`.env_example\`

\- The \`web/dist\` folder included in the release



The Python dependencies can be installed once:



\`\`\`powershell

python -m pip install -r requirements.txt

\`\`\`



**## Local Configuration**



For the local standalone test, FastAPI must serve both the API and the React build:



\`\`\`env

ITASSETFLOW_SERVE_WEB=true

ITASSETFLOW_COOKIE_SECURE=false

\`\`\`



Valid Supabase values are also required.



**## Start**



The file can be started by double-clicking:



\`\`\`text

Webserver_localhost.bat

\`\`\`



Alternatively, the backend can be started directly:



\`\`\`powershell

python src/web_main.py

\`\`\`



The local web application can then be accessed at:



\`\`\`text

http\://127.0.0.1:8000/#/login

\`\`\`



The API status can be checked separately:



\`\`\`text

http\://127.0.0.1:8000/api/health

\`\`\`



This variant is intended for functional testing, demonstrations, and testing a release package. IIS is used instead for permanent company operation.



**---**



**# Production Operation with IIS**







**## 1. Use the Release**



The completed release package is used for the company server. The folder contained within it



\`\`\`text

web/dist/

\`\`\`



has already been built. Therefore, **\*\*Node.js, npm, and Vite are not required\*\*** on the target server.



**## 2. Serve the Frontend via IIS**



IIS can point directly to the included build, for example:



\`\`\`text

C:\ITAssetFlow\web\dist

\`\`\`



Alternatively, the contents of \`web/dist\` can be copied into an existing IIS web directory.



The folder typically contains:



\`\`\`text

web/dist/

├── index.html

└── assets/

    ├── \*.js

    └── \*.css

\`\`\`



**## 3. Prepare the Backend**



The backend requires Python and the packages from:



\`\`\`text

requirements.txt

\`\`\`



Installation:



\`\`\`powershell

python -m pip install -r requirements.txt

\`\`\`



In addition, a production \`.env\` must be available on the server. For security reasons, this file is **\*\*not part of the GitHub release\*\***.



For IIS operation, FastAPI is used only as an API:



\`\`\`env

ITASSETFLOW_SERVE_WEB=false

ITASSETFLOW_WEB_HOST=0.0.0.0

ITASSETFLOW_WEB_PORT=8000

\`\`\`



\`ITASSETFLOW_COOKIE_SECURE\` and \`ITASSETFLOW_CORS_ORIGINS\` must be configured according to the actual internal HTTP/HTTPS configuration being used.



**## 4. Start the Backend**



The following file is available in the release for manual startup:



\`\`\`text

web_backend.cmd

\`\`\`



It starts:



\`\`\`text

src/web_main.py

\`\`\`



Alternatively, the backend can be started directly:



\`\`\`powershell

python src/web_main.py

\`\`\`



The API status can, for example, be checked using:



\`\`\`text

http\://localhost:8000/api/health

\`\`\`



checked.



**## 5. Permanent Operation as a Windows Service**



For production operation, the backend should not run permanently in an open CMD window.



**---**





**## GitHub Release**



For a release, a new production build is generated from the current \`main\` state and provided as a ZIP together with the files required for execution.



The following should not be included in the release package:



\`\`\`text

.env

web/node_modules/

\_\_pycache\_\_/

\*.pyc

.git/

\`\`\`



The React development environment containing \`web/src\`, \`node_modules\`, and the TypeScript/Vite configuration files is also not required for simply running the release package. The complete frontend source code remains traceable in the repository in the \`main\` branch.



**### Important When Downloading**





For directly testing the application, the provided release ZIP must be used, for example:



\`\`\`text

ITAssetFlow-v1.0..zip

\`\`\`



This package already contains the fully built \`web/dist\`.



**---**



**# Technologies**



**## Web Frontend**



\- React

\- TypeScript

\- Vite

\- React Router

\- CSS



**## Backend**



\- Python

\- FastAPI

\- Uvicorn



**## Database and API**



\- Supabase

\- PostgreSQL

\- PostgREST



**## Authentication and Permissions**



\- Supabase Auth

\- PostgreSQL Row Level Security

\- Database functions

\- Trigger

\- Views



**## Optional Desktop Version**



\- Python

\- PySide6

\- PyInstaller



**## Deployment**



\- Microsoft IIS

\- Windows Server

\- Render for the public demo instance



**---**



**# User Roles and Security**



ITAssetFlow uses three application roles.



\| Role | Database Value | Purpose |

\|---|---|---|

\| Administrator | \`admin\` | administrative and full editing permissions |

\| Editor | \`user\` | read and edit inventory data |

| Viewer | \`viewer\` | read-only access |



Authentication is handled through Supabase Auth.



The connection between the authenticated user and the employee record is established through \`employees.auth_user_id\`.



\`\`\`text

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

\`\`\`



Permissions are not only checked in the user interface.



The database additionally protects the relevant tables through Row Level Security.



The helper functions used include, among others:



\`\`\`text

private.current_app_role()

private.is_admin()

private.can_read_inventory()

private.can_edit_inventory()

\`\`\`



**## Security Principles**



\- Do not commit \`.env\` to Git

\- Do not store database passwords in the source code

\- Do not store user passwords in the source code

\- Do not use Supabase Service Role keys in the React frontend

\- Secure user access through Supabase Auth

\- Secure database access through RLS

\- Use HTTPS for regular web operation

\- Restrict firewall rules to the required network



The Supabase Publishable Key is intended for client applications. Actual access control is enforced through authentication and RLS.



**---**



**# Data Model**



The database is divided into several logical areas.



**## Organization and Warehouse Structure**



\`\`\`text

Organization

    │

    ▼

Site

    │

    ├── Department

    │

    └── Storage Location

\`\`\`



Important tables:



\`\`\`text

organizations

sites

departments

site_departments

storage_locations

employees

\`\`\`



**## Manufacturers and Product Data**



\`\`\`text

Manufacturer ─────┐

                  ├── Product Model

Category ─────────┘

     │

     └── Specification Schema

\`\`\`



Important tables:



\`\`\`text

manufacturers

product_categories

product_models

\`\`\`



Product categories can contain a specification schema.



This allows different technical properties to be defined for each category.



Product models store the corresponding concrete specifications.



**## Inventory**



Important tables:



\`\`\`text

assets

asset_locations

asset_assignments

asset_component_assignments

\`\`\`



This allows devices, locations, and assignments to be traced.



**## Stock**



Important tables:



\`\`\`text

stock_movements

stock_counts

stock_targets

\`\`\`



Views for stock information are also available:



\`\`\`text

stock_levels

stock_levels_total

\`\`\`



This allows stock levels to be traced based on the recorded material movements.



**## Software Management**



The database also contains tables for:



\`\`\`text

software_products

software_licenses

software_installations

\`\`\`



**## Additional Technical Tables**



\`\`\`text

audit_log

inventory_change_state

connection_test

\`\`\`



**---**



**# Project Structure**



The following structure shows the development state in the **\*\*\`main\` branch\*\***.



Generated folders such as \`\_\_pycache\_\_\`, \`node_modules\`, and \`web/dist\` are deliberately not listed as part of the actual source code.



\`\`\`text

ITAssetFlow/

│

├── src/

│   ├── infrastructure/

│   ├── ui/

│   │

│   ├── web_backend/

│   │   ├── routes/

│   │   ├── \_\_init\_\_.py

│   │   ├── app.py

│   │   ├── dependencies.py

│   │   └── settings_routes.py

│   │

│   ├── config.py

│   ├── inventory.py

│   ├── logging_config.py

│   ├── main.py

│   ├── settings_manager.py

│   └── web_main.py

│

├── web/

│   ├── public/

│   │

│   ├── src/

│   │   ├── api/

│   │   ├── assets/

│   │   │

│   │   ├── components/

│   │   │   ├── AboutDialog.tsx

│   │   │   ├── AssetDetailPanel.tsx

│   │   │   ├── InventorySidebar.tsx

│   │   │   ├── InventoryTable.tsx

│   │   │   └── MainMenu.tsx

│   │   │

│   │   ├── hooks/

│   │   │

│   │   ├── pages/

│   │   │   ├── AboutPage.tsx

│   │   │   ├── AssetFormPage.css

│   │   │   ├── AssetFormPage.tsx

│   │   │   ├── InventoryPage.tsx

│   │   │   ├── LoginPage.tsx

│   │   │   ├── SettingsPage.css

│   │   │   └── SettingsPage.tsx

│   │   │

│   │   ├── types/

│   │   ├── utils/

│   │   ├── App.css

│   │   ├── App.tsx

│   │   ├── index.css

│   │   └── main.tsx

│   │

│   ├── eslint.config.js

│   ├── index.html

│   ├── package-lock.json

│   ├── package.json

│   ├── tsconfig.app.json

│   ├── tsconfig.json

│   ├── tsconfig.node.json

│   └── vite.config.ts

│

├── .env.example

├── .gitignore

├── ITAssetFlow\.spec

├── README.md

├── requirements.txt

├── Webserver_localhost.bat

└── web_backend.cmd

\`\`\`



**## Generated Production Build**



After



\`\`\`powershell

cd web

npm.cmd ci

npm.cmd run build

\`\`\`



the following is additionally generated:



\`\`\`text

web/

└── dist/

    ├── index.html

    └── assets/

\`\`\`



**## Important Entry Points**



\| File | Purpose |

\|---|---|

\| \`src/web_main.py\` | starts the FastAPI web backend |

\| \`web/src/main.tsx\` | entry point of the React frontend |

\| \`src/main.py\` | starts the optional desktop application |

\| \`Webserver_localhost.bat\` | local standalone test using the completed \`web/dist\` |

\| \`web_backend.cmd\` | manual startup of the backend for IIS / real web server |

\| \`.env\` | local or server-specific configuration; not stored in Git |

\| \`.env.example\` | configuration template |

\| \`ITAssetFlow\.spec\` | PyInstaller configuration for the optional desktop application |



**---**



**# Configuration**



ITAssetFlow uses a \`.env\` file for environment-specific settings.



The actual \`.env\` must not be committed to Git or included in a public release.



The following values are generally required:



\`\`\`env

SUPABASE_URL=https\://example.supabase.co

SUPABASE_PUBLISHABLE_KEY=your_publishable_key



ITASSETFLOW_WEB_HOST=0.0.0.0

ITASSETFLOW_WEB_PORT=8000

\`\`\`



**## Local Standalone Test**



During local testing, FastAPI also serves the React frontend:



\`\`\`env

ITASSETFLOW_SERVE_WEB=true

ITASSETFLOW_COOKIE_SECURE=false

\`\`\`



**## IIS / Real Web Server**



During company operation, IIS serves the frontend. FastAPI only provides the API:



\`\`\`env

ITASSETFLOW_SERVE_WEB=false

ITASSETFLOW_WEB_HOST=0.0.0.0

ITASSETFLOW_WEB_PORT=8000

\`\`\`



In addition, the allowed browser origin is set according to the internal address, for example:



\`\`\`env

ITASSETFLOW_CORS_ORIGINS=http\://ITAssetFlow\.dlc-informatik.local

\`\`\`



If the entire setup is operated over HTTPS, the configuration must be adjusted accordingly and \`ITASSETFLOW_COOKIE_SECURE=true\` must be set.



**## Render Demo**



Render uses its own environment variables. The demo uses a separate Supabase instance and, among other settings:



\`\`\`env

ITASSETFLOW_SERVE_WEB=true

ITASSETFLOW_COOKIE_SECURE=true

ITASSETFLOW_CORS_ORIGINS=https\://itassetflow-demo.onrender.com

\`\`\`



**## Supabase Connection**



The Publishable Key being used is intended for client/application access. Actual access control is additionally enforced through Supabase Auth and Row Level Security.



The following must not be stored in the client or repository:



\- Database password

\- Service Role key

\- User passwords







**---**



**# Development Environment**



Python, Node.js, and npm are required for further development.



**## Python Dependencies**



These are installed automatically at startup via requirements.txt if they are not already installed. Alternatively, they can also be installed manually in the project directory:



\`\`\`powershell

python -m pip install -r requirements.txt

\`\`\`



**## Frontend Dependencies**



\`\`\`powershell

cd web

npm.cmd ci

cd ..

\`\`\`



\`npm.cmd ci\` uses the existing \`package-lock.json\`.



**## Development Mode**



\`\`\`powershell

python src/web_main.py --dev

\`\`\`



In development mode, the Vite development server is also used.



Typical local address:



\`\`\`text

http\://127.0.0.1:5173

\`\`\`



This operating mode is intended for development.



**---**



**# Rebuild Frontend**



After changes to the React frontend, a new production build must be generated.



\`\`\`powershell

cd web

npm.cmd ci

npm.cmd run build

\`\`\`



The new build is then located under:



\`\`\`text

web/dist/

\`\`\`



In the **\*\*\`main\` branch\*\***, this folder is not stored.

It is only used in the \`webapp\` branch for Render, where a completed production build is required.



If a special Render build was previously created, care must be taken before creating the company/release build to ensure that no Render-specific \`VITE_API_BASE_URL\` is still set in the local build environment.



**---**



**# Optional Desktop Application**



In addition to the web application, a native PySide6 client exists.

This application is not the main solution of the diploma thesis.



It remains available as an optional alternative in case a native Windows client is required for a specific use case.



Start:



\`\`\`powershell

python src/main.py

\`\`\`



The PyInstaller configuration is available for a Windows build:



\`\`\`text

ITAssetFlow\.spec

\`\`\`



The desktop application uses the same Supabase database and the same server-side permission rules.



**---**



**# Demo Database**



A separate Supabase database is used for the diploma thesis presentation and the public demo.



The demo environment is separated from the production database and has its own test users and demo data.

This allows ITAssetFlow to be demonstrated realistically without modifying the production environment.



Non-critical master data that can be transferred includes:



\- Organization

\- Sites

\- Departments

\- Storage locations

\- Manufacturers

\- Product categories

\- Specification definitions

\- Product models

\- Technical specifications



The following are not transferred:



\- Production user passwords

\- Real authentication sessions

\- Confidential employee data

\- Real device assignments

\- Real stock movements

\- Personal data or other sensitive operational data



**---**



**# Testing and Acceptance**



**## Roles**



**### Administrator**



The administrator has the most extensive permissions and can use administrative functions.



**### Editor**



The editor can read inventory data and modify the intended data.



**### Viewer**



The viewer has read-only access.

Write operations must be blocked server-side through RLS for this role.



**# Traceability**



A central goal of ITAssetFlow is not only to store the current state, but also to make changes and movements more traceable.



Among other things, this makes it possible to trace where a device was located, to whom a device was assigned, when material was moved, how a stock level was created, and which relevant changes were made.



This includes, among other things:



\`\`\`text

asset_locations

asset_assignments

asset_component_assignments

stock_movements

audit_log

\`\`\`







**---**



**# Scope**



The project is not intended to replace a complete ERP system, inventory management system, IT service management system

or procurement system. The web application is the primary final product.



The focus is on:



\- IT inventory

\- Stock levels

\- Material movements

\- Centralized data storage

\- Roles and permissions

\- Multi-user operation

\- Ease of use



**---**



**# Diploma Thesis Context**



The project is part of the TEKO diploma thesis:



**\*\*IT Inventory Process Optimization\*\***



**\*\*Diploma Candidate:\*\*** Sven Döring  

**\*\*Education:\*\*** Dipl. Informatiker HF, specialization in Systems Engineering  

**\*\*Class:\*\*** S-TIP-23-Di-z  

**\*\*Company:\*\*** DLC-Informatik GmbH



The internal material management department / warehouse of DLC-Informatik GmbH was defined as the internal customer.

The solution is intended to contribute to:



\- Saving resources

\- Reducing time and costs

\- Improving traceability of material movements

\- Improving stock overview

\- Supporting the planning of material procurement





**---**





**## Releases**



The GitHub release receives a separately created ZIP package. This contains the completed \`web/dist\` folder as well as the startup files for local testing and IIS/backend operation.



Alternatively, a demo version of the database can be viewed on Render:

https\://itassetflow-demo.onrender.com/#/



**---**



**# Usage**



The project is intended for internal purposes of DLC-Informatik GmbH as well as for educational and diploma thesis purposes.



No further public licensing or distribution is defined.
