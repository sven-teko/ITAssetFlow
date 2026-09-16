# ITAssetFlow

ITAssetFlow ist eine webbasierte Anwendung zur Verwaltung von IT-Inventar, Lagerbeständen und Materialbewegungen.

Das Projekt entstand im Rahmen meiner TEKO-Diplomarbeit **„Prozessoptimierung IT-Inventar“** bei der **DLC-Informatik GmbH**. Ziel ist es, die bestehende Inventar- und Lagerverwaltung transparenter, nachvollziehbarer und effizienter zu gestalten.

Die Webanwendung ist die Hauptversion von ITAssetFlow. Zusätzlich existiert eine native Desktop-Anwendung mit PySide6. Diese ist nicht als zweite Hauptlösung gedacht, sondern als optionale Alternative für einen spezifischen Spezialfall.

---

## Inhalt

- [Projektziel](#projektziel)
- [Funktionsumfang](#funktionsumfang)
- [Architektur](#architektur)
- [Bereitstellung im Überblick](#bereitstellung-im-überblick)
- [Online-Demo auf Render](#online-demo-auf-render)
- [Lokaler Webserver zum Testen](#lokaler-webserver-zum-testen)
- [Produktiver Betrieb mit IIS](#produktiver-betrieb-mit-iis)
- [GitHub-Branches und Releases](#github-branches-und-releases)
- [Technologien](#technologien)
- [Benutzerrollen und Sicherheit](#benutzerrollen-und-sicherheit)
- [Datenmodell](#datenmodell)
- [Projektstruktur](#projektstruktur)
- [Konfiguration](#konfiguration)
- [Entwicklungsumgebung](#entwicklungsumgebung)
- [Frontend neu bauen](#frontend-neu-bauen)
- [Optionale Desktop-Anwendung](#optionale-desktop-anwendung)
- [Demo-Datenbank](#demo-datenbank)
- [Test und Abnahme](#test-und-abnahme)
- [Abgrenzung](#abgrenzung)
- [Diplomarbeitskontext](#diplomarbeitskontext)

---

# Projektziel

Ausgangspunkt der Diplomarbeit ist die bestehende Verwaltung und Lagerung des IT-Inventars bei der DLC-Informatik GmbH.

Dazu gehören unter anderem:

- Notebooks und Computer
- Monitore
- Drucker
- Kassensysteme
- Netzwerkgeräte
- Computerkomponenten
- Kabel und Adapter
- Ersatzteile
- Installations- und Verbrauchsmaterial
- Lizenzen und Softwaredaten

Der bestehende Prozess wird analysiert und auf Schwachstellen sowie Optimierungsmöglichkeiten untersucht.
ITAssetFlow ist die praktische technische Umsetzung der daraus entwickelten Lösungsvariante.

Wichtige Ziele sind:

- zentrale Verwaltung des IT-Inventars
- bessere Übersicht über Bestände und Einzelgeräte
- nachvollziehbare Materialbewegungen
- klare Zuordnung zu Standorten, Abteilungen und Lagerorten
- strukturierte Verwaltung von Herstellern, Kategorien und Produktmodellen
- Reduktion manueller und mehrfach geführter Informationen
- rollenbasierter Mehrbenutzerbetrieb
- bessere Grundlage für Materialbeschaffung und Bestandsplanung
- Verbesserung von Transparenz und Nachvollziehbarkeit

Die Software ist damit ein Bestandteil der gesamten Prozessoptimierung und nicht das alleinige Ergebnis der Diplomarbeit.

---

# Funktionsumfang

ITAssetFlow unterscheidet zwischen inventarisierten Geräten und mengenbasierten Lagerartikeln.

## Einzelgeräte

Einzelgeräte werden separat erfasst und können individuell verfolgt werden.

Beispiele:

- Notebook
- Desktop-PC
- Monitor
- Drucker
- Kassensystem
- Switch
- Access Point

Je nach Gerät können unter anderem folgende Informationen gespeichert werden:

- Hersteller
- Produktmodell
- Kategorie
- Seriennummer
- Inventarnummer
- technische Spezifikationen
- Standort
- Abteilung
- Lagerort
- Zuweisung
- Status

## Mengenartikel

Mengenartikel werden über Lagerbewegungen geführt.

Beispiele:

- Netzwerkkabel
- Adapter
- SSDs
- RAM-Module
- Ersatzteile
- Verbrauchsmaterial
- Installationsmaterial

Dadurch lässt sich nachvollziehen, wie sich ein Lagerbestand zusammensetzt und wann Material ein- oder ausgelagert wurde.

## Weitere Funktionen

Der aktuelle Projektstand enthält unter anderem:

- Benutzeranmeldung
- Inventarübersicht
- Suche und Filterung
- konfigurierbare Tabellenansichten
- Detailansicht
- Erstellen und Bearbeiten von Inventareinträgen
- Löschen von Inventareinträgen
- Verwaltung von Herstellern
- Verwaltung von Kategorien
- Verwaltung von Produktmodellen
- kategoriespezifische technische Spezifikationen
- Verwaltung von Organisation, Standorten, Abteilungen und Lagerorten
- Lagerbewegungen
- Bestandsübersichten
- CSV-Import und CSV-Export
- Einstellungen
- Mehrbenutzerbetrieb
- rollenbasierte Zugriffssteuerung

---

# Architektur

Die Anwendung besteht aus mehreren Schichten.

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
          │ Python / PySide6    │       │    Web-Backend      │
          └─────────────────────┘       └──────────┬──────────┘
                                                   │
                                        ┌──────────▼──────────┐
                                        │      React          │
                                        │    Web-Frontend     │
                                        └─────────────────────┘
```

Die Desktop-Anwendung greift direkt über einen authentifizierten Supabase-Client auf die Daten zu.

Die Webanwendung verwendet dagegen den Weg:

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

Die Webanwendung ist die Hauptversion des Projekts.

Die native Desktop-Anwendung bleibt als optionale Alternative erhalten und verwendet dieselbe zentrale Datenbasis.

---

# Bereitstellung im Überblick

ITAssetFlow kann auf drei Arten ausgeführt werden. Für Entwicklung, Demo und produktiven Betrieb werden bewusst unterschiedliche Varianten verwendet.

| Variante | Zweck | Frontend | Backend |
|---|---|---|---|
| **Render-Demo** | öffentliche Diplomarbeits-Demo | `web/dist` wird über FastAPI ausgeliefert | FastAPI auf Render |
| **Lokaler Webserver** | schneller Test eines Release-Pakets | `web/dist` wird über FastAPI ausgeliefert | `Webserver_localhost.bat` / `src/web_main.py` |
| **Produktiver Webserver** | interner Firmenbetrieb | IIS liefert `web/dist` aus | `web_backend.cmd` / `src/web_main.py` |

Der Ordner `web/dist` ist ein **generiertes Build-Artefakt**. Er gehört deshalb nicht zum normalen Entwicklungsstand im `main`-Branch. Für die Render-Bereitstellung und für GitHub-Releases wird er gezielt erzeugt und mitgeliefert.

---

# Online-Demo auf Render

Für die Diplomarbeitspräsentation und für externe Tests steht eine separate Demo-Instanz auf **Render** zur Verfügung.

## Demo-URL

```text
https://itassetflow-demo.onrender.com
```

Die Demo ist vollständig von der produktiven Umgebung der DLC-Informatik GmbH getrennt. Sie verwendet eine eigene Supabase-Datenbank, eigene Demo-Benutzer und ausschliesslich Test- bzw. Demodaten.

## Technischer Aufbau

```text
Browser
   │
   ▼
Render
   │
   ├── React-Frontend aus web/dist
   │
   └── FastAPI / src/web_main.py
            │
            ▼
       Demo-Supabase
```

Auf Render liefert FastAPI zusätzlich das fertige React-Frontend aus. Dafür wird in der Render-Konfiguration unter anderem der Standalone-Modus aktiviert:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=true
ITASSETFLOW_CORS_ORIGINS=https://itassetflow-demo.onrender.com
```

Die für Render benötigten Supabase-Werte werden als Environment Variables im Render-Service gepflegt und nicht im Repository gespeichert.

## Branch `webapp`

Der Branch **`webapp`** dient ausschliesslich der Render-Bereitstellung.

Er enthält den für Render benötigten Stand inklusive des gebauten `web/dist`-Ordners. Änderungen an der eigentlichen Anwendung werden zuerst im `main`-Branch gepflegt und anschliessend für die Demo in den `webapp`-Branch übernommen.

Der Render-Build ist nicht als produktiver Firmen-Release gedacht. Für den internen Betrieb und für die Abgabe wird ein eigener Release-Build erstellt.

---

# Lokaler Webserver zum Testen

Ein GitHub-Release enthält bereits den gebauten Ordner `web/dist`. Dadurch kann die Webanwendung lokal getestet werden, ohne Node.js, npm oder Vite installieren zu müssen.

Zum Start dient:

```text
Webserver_localhost.bat
```

## Voraussetzungen

Benötigt werden:

- Python 3
- die Pakete aus `requirements.txt`
- eine gültige `.env`
- der im Release enthaltene Ordner `web/dist`

Die Python-Abhängigkeiten können einmalig installiert werden:

```powershell
python -m pip install -r requirements.txt
```

## Lokale Konfiguration

Für den lokalen Standalone-Test muss FastAPI neben der API auch den React-Build ausliefern:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=false
```

Zusätzlich werden die gültigen Supabase-Werte benötigt.

## Start

Die Datei kann per Doppelklick gestartet werden:

```text
Webserver_localhost.bat
```

Alternativ kann das Backend direkt gestartet werden:

```powershell
python src/web_main.py
```

Die lokale Webanwendung ist danach über folgende Adresse erreichbar:

```text
http://127.0.0.1:8000/#/login
```

Der API-Status kann separat geprüft werden:

```text
http://127.0.0.1:8000/api/health
```

Diese Variante ist für Funktionstests, Vorführungen und die Prüfung eines Release-Pakets gedacht. Für den dauerhaften Firmenbetrieb wird stattdessen IIS verwendet.

---

# Produktiver Betrieb mit IIS

Im internen Firmenbetrieb übernimmt **Microsoft IIS** die Bereitstellung des React-Frontends. FastAPI läuft getrennt davon als Backend.

```text
Browser
   │
   ├── Webseite
   ▼
  IIS
   │
   └── web/dist

Browser
   │
   └── API-Anfragen
          ▼
     FastAPI
          │
          ▼
       Supabase
```

Diese Trennung entspricht dem vorgesehenen produktiven Aufbau von ITAssetFlow.

## 1. Release verwenden

Für den Firmenserver wird das fertige Release-Paket verwendet. Der darin enthaltene Ordner

```text
web/dist/
```

ist bereits gebaut. Auf dem Zielserver werden deshalb **Node.js, npm und Vite nicht benötigt**.

## 2. Frontend über IIS bereitstellen

IIS kann direkt auf den enthaltenen Build verweisen, beispielsweise:

```text
C:\ITAssetFlow\web\dist
```

Alternativ kann der Inhalt von `web/dist` in ein bestehendes IIS-Webverzeichnis kopiert werden.

Der Ordner enthält typischerweise:

```text
web/dist/
├── index.html
└── assets/
    ├── *.js
    └── *.css
```

## 3. Backend vorbereiten

Das Backend benötigt Python und die Pakete aus:

```text
requirements.txt
```

Installation:

```powershell
python -m pip install -r requirements.txt
```

Zusätzlich muss auf dem Server eine produktive `.env` vorhanden sein. Diese Datei ist aus Sicherheitsgründen **nicht Bestandteil des GitHub-Releases**.

Für den IIS-Betrieb wird FastAPI nur als API verwendet:

```env
ITASSETFLOW_SERVE_WEB=false
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
```

`ITASSETFLOW_COOKIE_SECURE` und `ITASSETFLOW_CORS_ORIGINS` müssen passend zur tatsächlich verwendeten internen HTTP-/HTTPS-Konfiguration gesetzt werden.

## 4. Backend starten

Für den manuellen Start steht im Release folgende Datei zur Verfügung:

```text
web_backend.cmd
```

Sie startet:

```text
src/web_main.py
```

Das Backend kann alternativ direkt gestartet werden:

```powershell
python src/web_main.py
```

Der API-Status kann beispielsweise über

```text
http://localhost:8000/api/health
```

geprüft werden.

## 5. Dauerbetrieb als Windows-Dienst

Für den produktiven Betrieb sollte das Backend nicht dauerhaft in einem offenen CMD-Fenster laufen.

Empfohlen ist ein Windows-Dienst bzw. ein geeigneter Service-Wrapper, der `src/web_main.py` automatisch startet. Dadurch läuft das Backend auch ohne angemeldeten Benutzer und wird nach einem Serverneustart automatisch wieder gestartet.

`web_backend.cmd` bleibt trotzdem sinnvoll für manuelle Tests und Fehlersuche.

---

# GitHub-Branches und Releases

Repository, Render-Demo und ausführbarer Release haben unterschiedliche Aufgaben.

## `main`

Der Branch **`main`** enthält den eigentlichen Entwicklungs- und Quellcode der Anwendung.

Der generierte Ordner

```text
web/dist/
```

wird dort bewusst **nicht** mitgeführt. Er wird bei Bedarf mit Vite neu erzeugt.

Dadurch bleibt der Hauptbranch übersichtlich und enthält keine unnötigen Build-Artefakte.

## `webapp`

Der Branch **`webapp`** ist für die Bereitstellung der öffentlichen Render-Demo vorgesehen.

Dort befindet sich der für Render benötigte Produktionsbuild, damit Render sowohl FastAPI als auch die Weboberfläche bereitstellen kann.

## GitHub Release

Für einen Release wird aus dem aktuellen `main`-Stand ein neuer Produktionsbuild erzeugt und zusammen mit den für die Ausführung notwendigen Dateien als ZIP bereitgestellt.

Ein Release-Paket ist beispielsweise so aufgebaut:

```text
ITAssetFlow-vX.Y.Z/
│
├── README.md
├── requirements.txt
├── .env.example
├── Webserver_localhost.bat
├── web_backend.cmd
│
├── src/
│   ├── infrastructure/
│   ├── web_backend/
│   ├── config.py
│   ├── inventory.py
│   ├── logging_config.py
│   ├── settings_manager.py
│   └── web_main.py
│
└── web/
    └── dist/
        ├── index.html
        └── assets/
```

Nicht in das Release-Paket gehören unter anderem:

```text
.env
web/node_modules/
__pycache__/
*.pyc
.git/
```

Auch die React-Entwicklungsumgebung mit `web/src`, `node_modules` und den TypeScript-/Vite-Konfigurationsdateien ist für die reine Ausführung des Release-Pakets nicht nötig. Der vollständige Frontend-Quellcode bleibt im Repository im `main`-Branch nachvollziehbar.

### Wichtig beim Download

GitHub erzeugt bei jedem Release automatisch zusätzliche Dateien wie **Source code (zip)** und **Source code (tar.gz)**. Da `web/dist` im `main`-Branch nicht versioniert wird, enthalten diese automatischen Source-Code-Archive den fertigen Web-Build nicht.

Zum direkten Testen der Anwendung muss deshalb das separat bereitgestellte Release-Asset verwendet werden, beispielsweise:

```text
ITAssetFlow-v1.0.0.zip
```

Dieses Paket enthält `web/dist` bereits fertig gebaut.

---

# Technologien

## Web-Frontend

- React
- TypeScript
- Vite
- React Router
- CSS

## Backend

- Python
- FastAPI
- Uvicorn

## Datenbank und API

- Supabase
- PostgreSQL
- PostgREST

## Authentifizierung und Berechtigungen

- Supabase Auth
- PostgreSQL Row Level Security
- Datenbankfunktionen
- Trigger
- Views

## Optionale Desktop-Version

- Python
- PySide6
- PyInstaller

## Bereitstellung

- Microsoft IIS
- Windows Server
- Render für die öffentliche Demo-Instanz

---

# Benutzerrollen und Sicherheit

ITAssetFlow verwendet drei Anwendungsrollen.

| Rolle | Datenbankwert | Zweck |
|---|---|---|
| Administrator | `admin` | administrative und vollständige Bearbeitungsrechte |
| Bearbeiter | `user` | Inventardaten lesen und bearbeiten |
| Leser | `viewer` | ausschliesslich lesender Zugriff |

Die Anmeldung erfolgt über Supabase Auth.

Die Verbindung zwischen Auth-Benutzer und Mitarbeiterdatensatz wird über `employees.auth_user_id` hergestellt.

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

Die Berechtigungen werden nicht nur in der Oberfläche geprüft.

Die Datenbank schützt die relevanten Tabellen zusätzlich über Row Level Security.

Zu den verwendeten Hilfsfunktionen gehören unter anderem:

```text
private.current_app_role()
private.is_admin()
private.can_read_inventory()
private.can_edit_inventory()
```

## Sicherheitsgrundsätze

- `.env` nicht in Git einchecken
- keine Datenbankpasswörter im Quellcode speichern
- keine Benutzerpasswörter im Quellcode speichern
- keine Supabase Service-Role-Keys im React-Frontend verwenden
- Benutzerzugriffe über Supabase Auth absichern
- Datenbankzugriffe über RLS absichern
- für den regulären Webbetrieb HTTPS verwenden
- Firewall-Freigaben auf das notwendige Netzwerk beschränken

Der Supabase Publishable Key ist für Client-Anwendungen vorgesehen. Die eigentliche Zugriffskontrolle erfolgt über Authentifizierung und RLS.

---

# Datenmodell

Die Datenbank ist in mehrere logische Bereiche aufgeteilt.

## Organisation und Lagerstruktur

```text
Organisation
    │
    ▼
Standort
    │
    ├── Abteilung
    │
    └── Lagerort
```

Wichtige Tabellen:

```text
organizations
sites
departments
site_departments
storage_locations
employees
```

## Hersteller und Produktdaten

```text
Hersteller ───────┐
                  ├── Produktmodell
Kategorie ────────┘
     │
     └── Spezifikationsschema
```

Wichtige Tabellen:

```text
manufacturers
product_categories
product_models
```

Produktkategorien können ein Spezifikationsschema enthalten.

Dadurch können je Kategorie unterschiedliche technische Eigenschaften definiert werden.

Produktmodelle speichern die dazugehörigen konkreten Spezifikationen.

## Inventar

Wichtige Tabellen:

```text
assets
asset_locations
asset_assignments
asset_component_assignments
```

Damit können Geräte, Standorte und Zuordnungen nachvollzogen werden.

## Lagerbestand

Wichtige Tabellen:

```text
stock_movements
stock_counts
stock_targets
```

Zusätzlich stehen Views für Bestandsinformationen zur Verfügung:

```text
stock_levels
stock_levels_total
```

Der Bestand kann dadurch aus den erfassten Materialbewegungen nachvollzogen werden.

## Softwareverwaltung

Die Datenbank enthält ausserdem Tabellen für:

```text
software_products
software_licenses
software_installations
```

## Weitere technische Tabellen

```text
audit_log
inventory_change_state
connection_test
```

---

# Projektstruktur

Die folgende Struktur zeigt den Entwicklungsstand im **`main`-Branch**.

Generierte Ordner wie `__pycache__`, `node_modules` und `web/dist` sind bewusst nicht als Bestandteil des eigentlichen Quellcodes aufgeführt.

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

## Generierter Produktionsbuild

Nach

```powershell
cd web
npm.cmd ci
npm.cmd run build
```

wird zusätzlich erzeugt:

```text
web/
└── dist/
    ├── index.html
    └── assets/
```

Dieser Ordner wird im `main`-Branch nicht versioniert. Er wird für den `webapp`-Branch und für GitHub-Releases gezielt erzeugt.

## Wichtige Einstiegspunkte

| Datei | Zweck |
|---|---|
| `src/web_main.py` | Start des FastAPI-Web-Backends |
| `web/src/main.tsx` | Einstiegspunkt des React-Frontends |
| `src/main.py` | Start der optionalen Desktop-Anwendung |
| `Webserver_localhost.bat` | lokaler Standalone-Test mit dem fertigen `web/dist` |
| `web_backend.cmd` | manueller Start des Backends für IIS / echten Webserver |
| `.env` | lokale bzw. serverspezifische Konfiguration; wird nicht in Git gespeichert |
| `.env.example` | Vorlage für die Konfiguration |
| `ITAssetFlow.spec` | PyInstaller-Konfiguration der optionalen Desktop-Anwendung |

---

# Konfiguration

ITAssetFlow verwendet eine `.env`-Datei für umgebungsabhängige Einstellungen.

Die echte `.env` darf nicht in Git eingecheckt oder in einem öffentlichen Release mitgeliefert werden.

Grundsätzlich werden benötigt:

```env
SUPABASE_URL=https://example.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key

ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
```

## Lokaler Standalone-Test

Beim lokalen Test liefert FastAPI zusätzlich das React-Frontend aus:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=false
```

## IIS / echter Webserver

Beim Firmenbetrieb liefert IIS das Frontend aus. FastAPI stellt nur die API bereit:

```env
ITASSETFLOW_SERVE_WEB=false
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
```

Zusätzlich wird die erlaubte Browser-Origin passend zur internen Adresse gesetzt, beispielsweise:

```env
ITASSETFLOW_CORS_ORIGINS=http://ITAssetFlow.dlc-informatik.local
```

Bei einem vollständig über HTTPS betriebenen Aufbau muss die Konfiguration entsprechend auf HTTPS angepasst und `ITASSETFLOW_COOKIE_SECURE=true` gesetzt werden.

## Render-Demo

Render verwendet eigene Environment Variables. Die Demo nutzt eine separate Supabase-Instanz und unter anderem:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=true
ITASSETFLOW_CORS_ORIGINS=https://itassetflow-demo.onrender.com
```

## Supabase-Verbindung

Nicht im Client bzw. Repository zu speichern sind:

- Datenbankpasswort
- Service-Role-Key
- Benutzerpasswörter

Der verwendete Publishable Key ist für den vorgesehenen Client-/Anwendungszugriff gedacht; die eigentliche Zugriffskontrolle erfolgt zusätzlich über Supabase Auth und Row Level Security.

---

# Entwicklungsumgebung

Für die Weiterentwicklung werden Python, Node.js und npm benötigt.

## Python-Abhängigkeiten

```powershell
python -m pip install -r requirements.txt
```

## Frontend-Abhängigkeiten

```powershell
cd web
npm.cmd ci
cd ..
```

Durch `npm.cmd ci` wird der vorhandene `package-lock.json` verwendet.

## Entwicklungsmodus

```powershell
python src/web_main.py --dev
```

Im Entwicklungsmodus wird zusätzlich der Vite-Entwicklungsserver verwendet.

Typische lokale Adresse:

```text
http://127.0.0.1:5173
```

Diese Betriebsart ist für die Entwicklung gedacht.

---

# Frontend neu bauen

Nach Änderungen am React-Frontend muss ein neuer Produktionsbuild erzeugt werden.

```powershell
cd web
npm.cmd ci
npm.cmd run build
```

Der neue Build befindet sich danach unter:

```text
web/dist/
```

Im **`main`-Branch** wird dieser Ordner nicht gespeichert.

Er wird nur dort verwendet, wo ein fertiger Produktionsbuild benötigt wird:

- im Branch `webapp` für Render
- im GitHub-Release für lokale Tests
- im GitHub-Release für den produktiven IIS-Betrieb

Vor einem Release sollte der Build neu erstellt und vollständig getestet werden.

Wurde zuvor ein spezieller Render-Build erzeugt, muss vor dem Firmen-/Release-Build darauf geachtet werden, dass keine Render-spezifische `VITE_API_BASE_URL` mehr in der lokalen Build-Umgebung gesetzt ist.

---

# Optionale Desktop-Anwendung

Neben der Webanwendung existiert ein nativer PySide6-Client.

Diese Anwendung ist **nicht die Hauptlösung der Diplomarbeit**.

Sie bleibt als optionale Alternative bestehen, falls in einem speziellen Fall ein nativer Windows-Client benötigt wird.

Start:

```powershell
python src/main.py
```

Für einen Windows-Build steht die PyInstaller-Konfiguration zur Verfügung:

```text
ITAssetFlow.spec
```

Die Desktop-Anwendung verwendet dieselbe Supabase-Datenbasis und dieselben serverseitigen Berechtigungsregeln.

---

# Demo-Datenbank

Für die Diplomarbeitspräsentation und die öffentliche Demo wird eine separate Supabase-Datenbank verwendet.

Die Demo-Umgebung ist von der produktiven Datenbank getrennt.

Übernommen werden können unkritische Stammdaten wie:

- Organisation
- Standorte
- Abteilungen
- Lagerorte
- Hersteller
- Produktkategorien
- Spezifikationsdefinitionen
- Produktmodelle
- technische Spezifikationen

Nicht übernommen werden sollen:

- produktive Benutzerpasswörter
- reale Auth-Sitzungen
- vertrauliche Mitarbeiterdaten
- reale Gerätezuordnungen
- reale Lagerbewegungen
- personenbezogene oder andere sensible Betriebsdaten

Die Demo verwendet eigene Testbenutzer und eigene Demodaten.

Damit kann ITAssetFlow realistisch demonstriert werden, ohne die produktive Umgebung zu verändern.

---

# Test und Abnahme

Vor einem Release sollten die wichtigsten Benutzerabläufe mit den vorgesehenen Rollen geprüft werden.

## Rollen

### Administrator

Der Administrator besitzt die weitreichendsten Rechte und kann administrative Funktionen verwenden.

### Bearbeiter

Der Bearbeiter kann Inventardaten lesen und die vorgesehenen Daten bearbeiten.

### Leser

Der Leser besitzt ausschliesslich lesenden Zugriff.

Schreibende Zugriffe müssen für diese Rolle serverseitig durch RLS blockiert werden.

## Wichtige Testfälle

Vor einem Release sollten mindestens folgende Punkte geprüft werden:

- Login mit gültigem Benutzer
- Login mit falschem Passwort
- Logout
- Inventar laden
- Suche und Filterung
- Eintrag erstellen
- Eintrag bearbeiten
- Eintrag löschen
- Hersteller verwalten
- Kategorien verwalten
- Produktmodelle verwalten
- technische Spezifikationen erfassen
- Standort und Lagerort ändern
- Lagerbewegungen erfassen
- CSV-Import
- CSV-Export
- paralleler Zugriff mit mehreren Benutzern
- Rollen und Berechtigungen
- serverseitige RLS-Sperren
- Neustart des Backends
- Start über `Webserver_localhost.bat`
- Release-Build unter IIS mit `web_backend.cmd`
- Zugriff auf die Render-Demo

---

# Nachvollziehbarkeit

Ein zentrales Ziel von ITAssetFlow ist, nicht nur den aktuellen Zustand zu speichern, sondern Änderungen und Bewegungen nachvollziehbarer zu machen.

Dazu gehören unter anderem:

```text
asset_locations
asset_assignments
asset_component_assignments
stock_movements
audit_log
```

Damit kann unter anderem nachvollzogen werden:

- wo sich ein Gerät befand
- wem ein Gerät zugewiesen war
- wann Material verschoben wurde
- wie ein Bestand entstanden ist
- welche relevanten Änderungen vorgenommen wurden

---

# Abgrenzung

ITAssetFlow ist eine auf den untersuchten internen Inventar- und Lagerprozess zugeschnittene Lösung.

Das Projekt soll kein vollständiges:

- ERP-System
- Warenwirtschaftssystem
- IT-Service-Management-System
- Beschaffungssystem

ersetzen.

Der Schwerpunkt liegt auf:

- IT-Inventar
- Lagerbeständen
- Materialbewegungen
- Nachvollziehbarkeit
- zentraler Datenhaltung
- Rollen und Berechtigungen
- Mehrbenutzerbetrieb
- einfacher Bedienbarkeit

Die Webanwendung ist das primäre Endprodukt.

---

# Diplomarbeitskontext

Das Projekt gehört zur TEKO-Diplomarbeit:

**Prozessoptimierung IT-Inventar**

**Diplomand:** Sven Döring  
**Ausbildung:** Dipl. Informatiker HF, Fachrichtung Systemtechnik  
**Klasse:** S-TIP-23-Di-z  
**Unternehmen:** DLC-Informatik GmbH

Die offizielle Themeneingabe beschreibt die Analyse und Optimierung des bestehenden Prozesses zur Verwaltung und Lagerung des IT-Inventars.

Als interner Kunde wurde die Materialverwaltung bzw. das Lager der DLC-Informatik GmbH definiert.

Die Lösung soll dazu beitragen:

- Ressourcen einzusparen
- Zeit und Kosten zu reduzieren
- Materialbewegungen besser nachzuvollziehen
- die Bestandsübersicht zu verbessern
- die Planung von Materialbeschaffungen zu unterstützen

Zu den Erfolgskriterien gehören unter anderem:

- bestehenden Inventarprozess dokumentieren
- Schwachstellen und Optimierungspotenziale identifizieren
- Verbesserungsvorschläge ausarbeiten
- eine definitive Lösungsvariante umsetzen
- praktische Umsetzbarkeit nachweisen
- Transparenz und Nachvollziehbarkeit verbessern
- Potenziale für Zeit- und Kostenersparnis aufzeigen

ITAssetFlow ist die technische Umsetzung dieser Lösungsvariante.

---

# Projektgrundlagen

Für die Diplomarbeit und das Projekt werden insbesondere folgende Unterlagen berücksichtigt:

- Themeneingabe der Diplomarbeit
- TEKO-Richtlinien Diplomarbeit
- TEKO-Bewertungsraster Diplomarbeit
- Prüfungsreglement und Promotionsordnung
- DA-Ablaufplan TIP-23
- projektinterne Analyse-, Konzept- und Entwicklungsunterlagen

Die eigentliche Diplomarbeitsdokumentation behandelt zusätzlich:

- Ausgangslage
- Ist-Prozess
- Schwachstellenanalyse
- Variantenvergleich
- Soll-Prozess
- Begründung der gewählten Lösung
- Umsetzung
- Zielerreichung
- Reflexion und Lessons Learned

Diese README dient dagegen als technische Projekt- und Startdokumentation für ITAssetFlow.

---

# Hinweise zu Git

Folgende Dateien und Verzeichnisse sollen nicht in den normalen `main`-Branch aufgenommen werden:

```text
.env
__pycache__/
*.pyc
web/node_modules/
web/dist/
```

Zusätzlich dürfen keine produktiven Datenbankexports, Passwörter oder Secret Keys in Git gespeichert werden.

## Branch-Aufteilung

```text
main
└── vollständiger Entwicklungs- und Quellcode
    └── ohne web/dist

webapp
└── Bereitstellungsstand für Render
    └── mit dem für Render erzeugten web/dist
```

## Releases

Ein GitHub-Release erhält ein separat erstelltes ZIP-Paket. Dieses enthält den fertigen `web/dist`-Ordner sowie die Startdateien für den lokalen Test und den IIS-/Backend-Betrieb.

Dadurch bleibt der `main`-Branch sauber, während ein Release trotzdem ohne Node.js neu gebaut werden zu müssen direkt getestet oder auf einem Webserver bereitgestellt werden kann.

Die automatisch von GitHub erzeugten **Source code**-Archive sind nicht mit dem ausführbaren Release-Paket gleichzusetzen, da sie den nicht versionierten `web/dist`-Ordner aus `main` nicht enthalten.

---

# Projektstatus

ITAssetFlow befindet sich im Diplomarbeitsstand 2026.

Die Hauptanwendung besteht aus:

```text
React / TypeScript
        ↓
FastAPI
        ↓
Supabase / PostgreSQL
```

Zusätzlich bleibt eine native PySide6-Version als optionale Ausweichlösung bestehen.

---

# Nutzung

Das Projekt ist für interne Zwecke der DLC-Informatik GmbH sowie für Ausbildungs- und Diplomarbeitszwecke vorgesehen.

Eine weitergehende öffentliche Lizenzierung oder Weitergabe wird durch diese README nicht festgelegt.
