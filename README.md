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


Die Software ist damit ein Bestandteil der gesamten Prozessoptimierung und nicht das alleinige Ergebnis der Diplomarbeit.

---

# Funktionsumfang

ITAssetFlow unterscheidet zwischen inventarisierten Geräten und mengenbasierten Lagerartikeln.

## Einzelgeräte

Einzelgeräte werden separat erfasst und können individuell verfolgt werden.



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
- CSV sowie Postgre-SQL Import und Export
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


Auf Render liefert FastAPI zusätzlich das fertige React-Frontend aus. Dafür wird in der Render-Konfiguration unter anderem der Standalone-Modus aktiviert:

```env
ITASSETFLOW_SERVE_WEB=true
ITASSETFLOW_COOKIE_SECURE=true
ITASSETFLOW_CORS_ORIGINS=https://itassetflow-demo.onrender.com
```

Die für Render benötigten Supabase-Werte werden als Environment Variables im Render-Service gepflegt und nicht im Repository gespeichert.

## Branch `webapp`

Der Branch **`webapp`** dient ausschliesslich der Render-Bereitstellung.

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
- eine gültige `.env` z.b. aus `.env_example`
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

---


## GitHub Release

Für einen Release wird aus dem aktuellen `main`-Stand ein neuer Produktionsbuild erzeugt und zusammen mit den für die Ausführung notwendigen Dateien als ZIP bereitgestellt.

Nicht in das Release-Paket gehören:

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
|Betrachterr | `viewer` | ausschliesslich lesender Zugriff |

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

Der verwendete Publishable Key ist für den vorgesehenen Client-/Anwendungszugriff gedacht, die eigentliche Zugriffskontrolle erfolgt zusätzlich über Supabase Auth und Row Level Security.

Nicht im Client bzw. Repository zu speichern sind:

- Datenbankpasswort
- Service-Role-Key
- Benutzerpasswörter



---

# Entwicklungsumgebung

Für die Weiterentwicklung werden Python, Node.js und npm benötigt.

## Python-Abhängigkeiten

Diese werden beim Start über requirements.txt automatisch installiert, falls dies nicht der Fall ist. Alternativ können diese auch manuell im Projektordner installiert werden:

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
Er wird nur im Branch `webapp` für Render verwendet, wo ein fertiger Produktionsbuild benötigt wird.

Wurde zuvor ein spezieller Render-Build erzeugt, muss vor dem Firmen-/Release-Build darauf geachtet werden, dass keine Render-spezifische `VITE_API_BASE_URL` mehr in der lokalen Build-Umgebung gesetzt ist.

---

# Optionale Desktop-Anwendung

Neben der Webanwendung existiert ein nativer PySide6-Client.
Diese Anwendung ist nicht die Hauptlösung der Diplomarbeit.

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

Die Demo-Umgebung ist von der produktiven Datenbank getrennt und hat eigene Testbenutzer sowie eigene Demodaten.
Somit kann ITAssetFlow realistisch demonstriert werden, ohne die produktive Umgebung zu verändern.

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

Nicht übernommen werden:

- produktive Benutzerpasswörter
- reale Auth-Sitzungen
- vertrauliche Mitarbeiterdaten
- reale Gerätezuordnungen
- reale Lagerbewegungen
- personenbezogene oder andere sensible Betriebsdaten

---

# Test und Abnahme

## Rollen

### Administrator

Der Administrator besitzt die weitreichendsten Rechte und kann administrative Funktionen verwenden.

### Bearbeiter

Der Bearbeiter kann Inventardaten lesen und die vorgesehenen Daten bearbeiten.

### Betrachter

Der Betrachter besitzt ausschliesslich lesenden Zugriff.
Schreibende Zugriffe müssen für diese Rolle serverseitig durch RLS blockiert werden.

# Nachvollziehbarkeit

Ein zentrales Ziel von ITAssetFlow ist, nicht nur den aktuellen Zustand zu speichern, sondern Änderungen und Bewegungen nachvollziehbarer zu machen.

Damit kann unter anderem nachvollzogen werden wo sich ein Gerät befand, wem ein Gerät zugewiesen war, wann Material verschoben wurde, wie ein Bestand entstanden ist und welche relevanten Änderungen vorgenommen wurden.

Dazu gehören unter anderem:

```text
asset_locations
asset_assignments
asset_component_assignments
stock_movements
audit_log
```



---

# Abgrenzung

Das Projekt soll kein vollständiges ERP-System, Warenwirtschaftssystem, IT-Service-Management-System
oder Beschaffungssystem ersetzen. Die Webanwendung ist das primäre Endprodukt.

Der Schwerpunkt liegt auf:

- IT-Inventar
- Lagerbeständen
- Materialbewegungen
- zentraler Datenhaltung
- Rollen und Berechtigungen
- Mehrbenutzerbetrieb
- einfacher Bedienbarkeit

---

# Diplomarbeitskontext

Das Projekt gehört zur TEKO-Diplomarbeit:

**Prozessoptimierung IT-Inventar**

**Diplomand:** Sven Döring  
**Ausbildung:** Dipl. Informatiker HF, Fachrichtung Systemtechnik  
**Klasse:** S-TIP-23-Di-z  
**Unternehmen:** DLC-Informatik GmbH

Als interner Kunde wurde die Materialverwaltung bzw. das Lager der DLC-Informatik GmbH definiert.
Die Lösung soll dazu beitragen:

- Ressourcen einzusparen
- Zeit und Kosten zu reduzieren
- Materialbewegungen besser nachzuvollziehen
- die Bestandsübersicht zu verbessern
- die Planung von Materialbeschaffungen zu unterstützen


---


## Releases

Der GitHub-Release erhält ein separat erstelltes ZIP-Paket. Dieses enthält den fertigen `web/dist`-Ordner sowie die Startdateien für den lokalen Test und den IIS-/Backend-Betrieb.

Alternativ ist eine Demoversion der Datenbank auf Render ersichtlich:
https://itassetflow-demo.onrender.com/#/

---

# Nutzung

Das Projekt ist für interne Zwecke der DLC-Informatik GmbH sowie für Ausbildungs- und Diplomarbeitszwecke vorgesehen.

Eine weitergehende öffentliche Lizenzierung oder Weitergabe wird nicht festgelegt.
