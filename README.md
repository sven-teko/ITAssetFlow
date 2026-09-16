# ITAssetFlow

ITAssetFlow ist eine webbasierte Anwendung zur Verwaltung von IT-Inventar, Lagerbeständen und Materialbewegungen.

Das Projekt entstand im Rahmen meiner TEKO-Diplomarbeit **„Prozessoptimierung IT-Inventar“** bei der **DLC-Informatik GmbH**. Ziel ist es, die bestehende Inventar- und Lagerverwaltung transparenter, nachvollziehbarer und effizienter zu gestalten.

Die **Webanwendung ist die Hauptversion** von ITAssetFlow. Zusätzlich existiert eine native Desktop-Anwendung mit PySide6. Diese ist nicht als zweite Hauptlösung gedacht, sondern als optionale Alternative für einen spezifischen Notfall oder Spezialfall.

---

## Inhalt

- [Projektziel](#projektziel)
- [Funktionsumfang](#funktionsumfang)
- [Architektur](#architektur)
- [Projekt ausführen](#projekt-ausführen)
- [Empfohlener Betrieb mit IIS](#empfohlener-betrieb-mit-iis)
- [Lokaler Testserver](#lokaler-testserver)
- [Online-Demo](#online-demo)
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
- SSDs und RAM
- Kabel und Adapter
- Ersatzteile
- Installations- und Verbrauchsmaterial

Der bestehende Prozess wird analysiert, dokumentiert und auf Schwachstellen sowie Optimierungsmöglichkeiten untersucht.

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

ITAssetFlow unterscheidet zwischen **einzeln inventarisierten Geräten** und **mengenbasierten Lagerartikeln**.

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

# Projekt ausführen

Für ITAssetFlow sind drei Betriebsarten vorgesehen:

1. **Release auf einem Webserver bereitstellen**  
   Dies ist die empfohlene Variante für den regulären Betrieb.

2. **Lokalen Testserver über `testserver.bat` starten**  
   Diese Variante ist für lokale Tests und Demonstrationen gedacht.

3. **Online-Demo verwenden**  
   Eine separate Demo-Instanz wird auf DigitalOcean gehostet.

---

# Empfohlener Betrieb mit IIS

Für den regulären internen Betrieb wird empfohlen, den bereits gebauten Frontend-Ordner aus einem Release zu verwenden und diesen über einen Webserver wie **Microsoft IIS** bereitzustellen.

Damit muss das React-Frontend auf dem Zielserver nicht erneut mit Node.js gebaut werden.

## 1. Release verwenden

Aus dem gewünschten Release wird der enthaltene `dist`-Ordner verwendet.

Typischer Inhalt:

```text
dist/
├── index.html
└── assets/
    ├── *.js
    └── *.css
```

Je nach Release können zusätzliche statische Dateien enthalten sein.

## 2. `dist` auf den Webserver kopieren

Der Inhalt des `dist`-Ordners wird auf den Webserver kopiert.

Beispiel:

```text
C:\inetpub\ITAssetFlow\
```

Danach sollte die `index.html` direkt im konfigurierten IIS-Verzeichnis liegen.

Beispiel:

```text
C:\inetpub\ITAssetFlow\
├── index.html
└── assets\
```

IIS stellt in dieser Variante das fertige React-Frontend bereit.

## 3. IIS konfigurieren

Im IIS-Manager wird eine Website oder eine entsprechende Site-Bindung für ITAssetFlow eingerichtet.

Für den internen Zielbetrieb ist beispielsweise folgende Adresse vorgesehen:

```text
https://ITAssetFlow.dlc-informatik.local
```

Bei Verwendung von HTTPS muss ein passendes Zertifikat eingerichtet werden.

Sind bereits andere Webseiten auf Port 80 oder 443 vorhanden, können diese über unterschiedliche Hostnamen getrennt werden.

## 4. Backend vorbereiten

Das Backend benötigt Python sowie die in `requirements.txt` definierten Python-Pakete.

Installation:

```powershell
python -m pip install -r requirements.txt
```

Zusätzlich wird eine gültige `.env` benötigt.

Beispiel:

```env
SUPABASE_URL=https://example.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key

ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
ITASSETFLOW_COOKIE_SECURE=true

ITASSETFLOW_CORS_ORIGINS=https://ITAssetFlow.dlc-informatik.local
```

## 5. Backend starten

Das FastAPI-Backend wird über `web_main.py` gestartet:

```powershell
python src/web_main.py
```

Der verwendete Port wird über die `.env` festgelegt.

Beispiel:

```text
8000
```

Das Frontend kommuniziert anschliessend mit diesem Backend.

## 6. Dauerbetrieb

Für einen regulären Serverbetrieb sollte `web_main.py` nach einem Serverneustart automatisch gestartet werden.

Dies kann beispielsweise über:

- einen Windows-Dienst
- die Windows-Aufgabenplanung
- einen bestehenden Prozessmanager

erfolgen.

Die konkrete Umsetzung hängt von der verwendeten Serverumgebung ab.

## 7. Firewall

Falls das Backend direkt über einen eigenen Port erreichbar sein muss, muss dieser entsprechend freigegeben werden.

Beispiel für Port 8000:

```powershell
New-NetFirewallRule `
  -DisplayName "ITAssetFlow Backend" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8000 `
  -Action Allow
```

Die Freigabe sollte nur für das tatsächlich benötigte interne Netzwerk erfolgen.

## Betriebsübersicht

```text
Browser
   │
   ├── HTTPS
   ▼
IIS
   │
   └── React-Frontend aus dem Release / dist

Browser
   │
   ├── API
   ▼
FastAPI / src/web_main.py
   │
   ▼
Supabase
```

Für den Serverbetrieb wird bewusst der fertige Frontend-Build aus dem Release verwendet.

Node.js und Vite werden auf dem Zielserver dadurch nicht benötigt.

---

# Lokaler Testserver

Für einen schnellen lokalen Funktionstest steht im Projekt die Datei

```text
testserver.bat
```

zur Verfügung.

Sie ist für lokale Tests und Demonstrationen gedacht und nicht für den dauerhaften Produktivbetrieb.

## Start

Die Datei kann direkt per Doppelklick gestartet werden.

Alternativ:

```powershell
.\testserver.bat
```

Damit wird die für den lokalen Test vorgesehene Serverumgebung gestartet.

Diese Variante eignet sich insbesondere für:

- schnelle Funktionstests
- Vorführungen
- lokale Tests auf einem Entwicklungsrechner
- Prüfung eines Release-Standes ohne IIS-Einrichtung

Für den regulären Serverbetrieb wird dagegen die Bereitstellung des `dist`-Ordners über IIS oder einen vergleichbaren Webserver empfohlen.

---

# Online-Demo

Für die Diplomarbeitspräsentation und für externe Tests existiert zusätzlich eine separate Demo-Instanz auf **DigitalOcean**.

Die Demo ist von der produktiven Umgebung der DLC-Informatik GmbH getrennt.

## Demo-URL

```text
<DIGITALOCEAN-DEMO-URL>
```

Die endgültige URL wird hier eingetragen, sobald die öffentliche Adresse feststeht.

Die Demo-Instanz verwendet:

- eine eigene Supabase-Datenbank
- separate Demo-Benutzer
- Test- und Demodaten
- keine produktiven Authentifizierungsdaten
- keine vertraulichen Inventardaten der DLC-Informatik GmbH

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
- DigitalOcean für die Demo-Instanz

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

Die folgende Struktur entspricht dem aktuellen Aufbau von ITAssetFlow.

Generierte Ordner wie `__pycache__` und `node_modules` sind bewusst nicht als Bestandteil der eigentlichen Quellcode-Struktur aufgeführt.

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
│   ├── dist/
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
├── .env
├── .env.example
├── .gitignore
├── ITAssetFlow.spec
├── README.md
├── requirements.txt
└── testserver.bat
```

## Wichtige Einstiegspunkte

| Datei | Zweck |
|---|---|
| `src/web_main.py` | Start des FastAPI-Web-Backends |
| `web/src/main.tsx` | Einstiegspunkt des React-Frontends |
| `src/main.py` | Start der optionalen Desktop-Anwendung |
| `testserver.bat` | lokaler Testserver |
| `.env` | lokale bzw. serverspezifische Konfiguration |
| `.env.example` | Vorlage für die Konfiguration |
| `ITAssetFlow.spec` | PyInstaller-Konfiguration |

---

# Konfiguration

ITAssetFlow verwendet eine `.env`-Datei für umgebungsabhängige Einstellungen.

Die echte `.env` darf nicht in Git eingecheckt werden.

Beispiel:

```env
SUPABASE_URL=https://example.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key

ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
ITASSETFLOW_COOKIE_SECURE=false

ITASSETFLOW_CORS_ORIGINS=http://127.0.0.1:5173
```

Für einen internen HTTPS-Betrieb:

```env
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
ITASSETFLOW_COOKIE_SECURE=true

ITASSETFLOW_CORS_ORIGINS=https://ITAssetFlow.dlc-informatik.local
```

## Supabase-Verbindung

Benötigt werden:

```env
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

Nicht im Client zu speichern sind:

- Datenbankpasswort
- Service-Role-Key
- Benutzerpasswörter

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

Vor einem Release sollte dieser Build neu erstellt und vollständig getestet werden.

Der fertige `dist`-Ordner kann anschliessend auf einen Webserver wie IIS kopiert werden.

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
- Start über `testserver.bat`
- Release-Build unter IIS
- Zugriff auf die DigitalOcean-Demo

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

Folgende Dateien und Verzeichnisse sollten nicht in das Repository aufgenommen werden:

```text
.env
__pycache__/
*.pyc
web/node_modules/
```

Zusätzlich dürfen keine produktiven Datenbankexports, Passwörter oder Secret Keys in Git gespeichert werden.

Der `dist`-Ordner ist ein Build-Artefakt. Für Releases kann er bewusst mitgeliefert werden, damit das Frontend ohne erneuten Node.js-Build auf einem Webserver bereitgestellt werden kann.

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
