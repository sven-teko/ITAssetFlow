# ITAssetFlow

ITAssetFlow ist eine Anwendung zur Verwaltung von IT-Inventar, Lagerbeständen und Materialbewegungen.

Das Projekt stellt zwei Benutzeroberflächen bereit:

- **Native Desktop-Anwendung** mit Python und PySide6
- **Webanwendung** mit React und FastAPI

Beide Varianten verwenden dieselbe zentrale Supabase-/PostgreSQL-Datenbasis und sind für den Mehrbenutzerbetrieb ausgelegt.

---

## Ziel des Projekts

ITAssetFlow soll die Verwaltung von IT-Materialien und IT-Inventar zentralisieren und vereinfachen.

Typische Anwendungsfälle sind:

- Verwaltung von einzeln inventarisierten Geräten
- Verwaltung von mengenbasierten Lagerartikeln
- Zuordnung zu Standorten, Abteilungen und Lagerorten
- Verwaltung von Herstellern, Produktmodellen und Kategorien
- Technische Spezifikationen je Produktkategorie
- Suche, Filterung und konfigurierbare Tabellenansichten
- Mehrbenutzerbetrieb über eine zentrale Datenbank
- Nutzung wahlweise als native Windows-Anwendung oder Webanwendung

Beispiele für einzeln inventarisierte Geräte:

- Computer
- Notebooks
- Monitore
- Drucker
- Kassensysteme
- Netzwerkgeräte

Beispiele für mengenbasierte Lagerartikel:

- Kabel
- SSDs
- RAM-Module
- Ersatzteile
- Adapter
- Verbrauchs- und Installationsmaterial

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

Die Desktop-Anwendung greift direkt über den authentifizierten Supabase-Client auf die Daten zu.

Die Webanwendung verwendet dagegen:

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

Jeder Webbenutzer besitzt eine eigene authentifizierte Sitzung. Dadurch können mehrere Benutzer gleichzeitig mit der Anwendung arbeiten.

---

# Technologien

## Backend / gemeinsame Logik

- **Python**
- **Supabase**
- **PostgreSQL**
- **PostgREST**
- **FastAPI**
- **Uvicorn**

## Native Benutzeroberfläche

- **PySide6**

## Web-Frontend

- **React**
- **TypeScript**
- **Vite**
- **React Router**

## Produktivbetrieb

- optional **Microsoft IIS**
- React-Produktionsbuild aus `web/dist`
- FastAPI auf Port `8000`

---

# Projektstruktur

Die genaue Struktur kann sich während der Entwicklung erweitern. Die wichtigsten Bereiche sind:

```text
ITAssetFlow/
├── README.md
├── requirements.txt
├── .env
├── .env.example
│
├── src/
│   ├── main.py
│   ├── web_main.py
│   ├── inventory.py
│   ├── settings_manager.py
│   │
│   ├── infrastructure/
│   │   ├── supabase_client.py
│   │   ├── asset_repository.py
│   │   ├── data_transfer_service.py
│   │   └── ...
│   │
│   ├── ui/
│   │   ├── main_window.py
│   │   ├── asset_table_widget.py
│   │   ├── inventory_sidebar.py
│   │   ├── asset_detail_sidebar.py
│   │   ├── settings_dialog.py
│   │   └── ...
│   │
│   └── web_backend/
│       ├── app.py
│       ├── settings_routes.py
│       └── ...
│
└── web/
    ├── package.json
    ├── package-lock.json
    ├── index.html
    │
    ├── public/
    │   └── logo.png
    │
    ├── src/
    │   ├── api/
    │   ├── components/
    │   ├── hooks/
    │   ├── pages/
    │   ├── types/
    │   ├── utils/
    │   ├── App.tsx
    │   └── main.tsx
    │
    └── dist/
        ├── index.html
        ├── logo.png
        └── assets/
```

---

# Konfiguration

ITAssetFlow verwendet eine `.env`-Datei für lokale bzw. serverseitige Konfigurationswerte.

Die echte `.env` darf **nicht in Git eingecheckt werden**.

Beispiel:

```env
SUPABASE_URL=https://example.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key

ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
ITASSETFLOW_COOKIE_SECURE=false

ITASSETFLOW_CORS_ORIGINS=http://itassetflow.firma.local
```

Hinweise:

- `ITASSETFLOW_WEB_HOST=0.0.0.0` erlaubt den Zugriff auf FastAPI aus dem lokalen Netzwerk.
- `ITASSETFLOW_WEB_PORT=8000` startet das Backend auf Port 8000.
- Bei normalem HTTP muss `ITASSETFLOW_COOKIE_SECURE=false` verwendet werden.
- Bei HTTPS sollte `ITASSETFLOW_COOKIE_SECURE=true` gesetzt werden.
- Unter `ITASSETFLOW_CORS_ORIGINS` werden die erlaubten Web-Frontend-Adressen eingetragen.

Keine Service-Role-Keys, Benutzerpasswörter oder andere geheimen Werte in das React-Frontend bzw. in `VITE_*`-Variablen eintragen. Werte im React-Build sind für den Browser sichtbar.

---

# Python-Abhängigkeiten

Die Python-Abhängigkeiten befinden sich in:

```text
requirements.txt
```

Beim Start von `src/main.py` bzw. `src/web_main.py` werden fehlende Python-Abhängigkeiten geprüft und bei Bedarf installiert.

Alternativ können sie manuell installiert werden:

```powershell
python -m pip install -r requirements.txt
```

---

# Native Desktop-Anwendung starten

Die native PySide6-Version wird aus dem Projektverzeichnis gestartet:

```powershell
python src/main.py
```

Ablauf:

```text
main.py
   ↓
Python-Abhängigkeiten prüfen
   ↓
Login
   ↓
Supabase Auth
   ↓
Native PySide6-Hauptanwendung
```

Die native Anwendung kann parallel zur Webanwendung verwendet werden, sofern beide dieselbe Datenbank und dieselben Berechtigungsregeln verwenden.

---

# Webanwendung – Entwicklung

Für die Entwicklung des React-Frontends werden **Node.js und npm** benötigt.

Einmalig:

```powershell
cd web
npm.cmd install
```

Entwicklungsmodus starten:

```powershell
cd ..
python src/web_main.py --dev
```

Im Entwicklungsmodus startet zusätzlich der Vite-Entwicklungsserver.

Typische lokale Adresse:

```text
http://127.0.0.1:5173
```

Der Entwicklungsmodus ist **nicht** für einen produktiven Server vorgesehen.

---

# React-Produktionsbuild erstellen

Für einen produktiven oder reproduzierbaren Test wird React zuerst kompiliert.

```powershell
cd web
npm.cmd install
npm.cmd run build
```

Danach entsteht:

```text
web/dist/
├── index.html
├── logo.png
└── assets/
    ├── *.js
    └── *.css
```

Der Ordner `dist` enthält die fertig kompilierte Weboberfläche.

Auf dem späteren Benutzer- oder Testrechner wird für diese Dateien **kein Node.js, npm oder Vite mehr benötigt**.

Für eine Diplomarbeits-Abgabe bzw. ein Testpaket sollte ein aktueller `web/dist`-Ordner mitgeliefert werden, damit die Webanwendung ohne lokalen React-Build getestet werden kann.

---

# Webanwendung ohne IIS testen

Dies ist die einfachste Variante für einen lokalen Test oder für einen Diplomlehrer.

## Voraussetzungen

Auf dem Testrechner werden benötigt:

- Python
- Projektdateien
- `requirements.txt`
- gültige `.env`
- bereits erstellter Ordner `web/dist`

Node.js und Vite sind **nicht erforderlich**, wenn `web/dist` bereits vorhanden ist.

## Start

Im Projektordner:

```powershell
python src/web_main.py
```

FastAPI startet anschließend standardmäßig auf dem konfigurierten Port.

Wenn die `.env` zum Beispiel enthält:

```env
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
```

kann die Anwendung auf demselben Rechner aufgerufen werden über:

```text
http://127.0.0.1:8000
```

FastAPI liefert in dieser Variante sowohl die React-Weboberfläche als auch die API aus.

```text
Browser
   ↓
http://127.0.0.1:8000
   ↓
FastAPI
   ├── React aus web/dist
   └── /api/*
```

---

# Webanwendung direkt im internen Netzwerk testen

Soll ein anderer Rechner im gleichen Netzwerk direkt auf die Anwendung zugreifen, muss FastAPI auf allen Netzwerkschnittstellen lauschen.

`.env`:

```env
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
ITASSETFLOW_COOKIE_SECURE=false
```

Server starten:

```powershell
python src/web_main.py
```

Die IPv4-Adresse des Servers kann unter Windows ermittelt werden mit:

```powershell
ipconfig
```

Beispiel:

```text
IPv4-Adresse: 100.92.245.27
```

Ein Client im gleichen Netzwerk öffnet anschließend:

```text
http://100.92.245.27:8000
```

## Windows-Firewall

Falls Port 8000 noch nicht erreichbar ist, kann auf dem Server eine Firewall-Regel erstellt werden.

PowerShell als Administrator:

```powershell
New-NetFirewallRule `
  -DisplayName "ITAssetFlow Backend" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8000 `
  -Action Allow
```

Danach können mehrere Benutzer gleichzeitig über dieselbe Serveradresse auf ITAssetFlow zugreifen.

---

# Webanwendung mit IIS betreiben

ITAssetFlow kann zusätzlich zu einer bereits bestehenden Intranet-Seite auf demselben IIS-Server betrieben werden.

Für die hier beschriebene Variante werden **keine zusätzlichen IIS-Erweiterungen** wie URL Rewrite oder Application Request Routing benötigt.

Die Architektur lautet:

```text
                     Windows Server
                           │
          ┌────────────────┴────────────────┐
          │                                 │
          ▼                                 ▼
       IIS :80                       FastAPI :8000
          │                                 │
          ▼                                 ▼
   React aus dist                    /api/*
          │                                 │
          └────────── Browser ──────────────┘
```

IIS liefert nur die statischen React-Dateien aus.

FastAPI läuft separat auf Port 8000 und verarbeitet Login, Inventarzugriffe, Einstellungen, Import/Export usw.

---

## 1. React-Build erstellen

Auf einem Entwicklungsrechner mit Node.js:

```powershell
cd web
npm.cmd install
npm.cmd run build
```

Danach den Inhalt von:

```text
web/dist/
```

in einen IIS-Ordner kopieren, zum Beispiel:

```text
C:\inetpub\ITAssetFlow\
```

Der IIS-Ordner sollte anschließend ungefähr so aussehen:

```text
C:\inetpub\ITAssetFlow\
├── index.html
├── logo.png
└── assets\
```

Der physische IIS-Pfad muss direkt auf den Ordner zeigen, in dem sich `index.html` befindet.

---

## 2. Neue IIS-Website erstellen

Im **IIS-Manager**:

```text
Sites
→ Add Website...
```

Beispiel:

```text
Site name:
ITAssetFlow

Physical path:
C:\inetpub\ITAssetFlow

Type:
http

IP address:
All Unassigned

Port:
80

Host name:
itassetflow.firma.local
```

Eine bereits vorhandene Intranet-Webseite kann weiterhin auf derselben IP und demselben Port laufen.

IIS unterscheidet die Webseiten anhand des Hostnamens.

Beispiel:

```text
intranet.firma.local
        ↓
bestehende Intranet-Seite

itassetflow.firma.local
        ↓
ITAssetFlow
```

---

## 3. Interne Test-Domain ohne DNS

Für einen Test ist kein DNS-Eintrag erforderlich.

Auf dem Client-PC kann stattdessen die Windows-`hosts`-Datei verwendet werden:

```text
C:\Windows\System32\drivers\etc\hosts
```

Die Datei muss mit Administratorrechten bearbeitet werden.

Beispiel:

```text
100.92.245.27    itassetflow.firma.local
```

Danach kann optional der DNS-Cache geleert werden:

```powershell
ipconfig /flushdns
```

Test:

```powershell
ping itassetflow.firma.local
```

Die angezeigte IP muss der IP des IIS-Servers entsprechen.

---

## 4. FastAPI für IIS starten

Auf dem Server muss das Python-Backend weiterhin laufen.

`.env`:

```env
ITASSETFLOW_WEB_HOST=0.0.0.0
ITASSETFLOW_WEB_PORT=8000
ITASSETFLOW_COOKIE_SECURE=false
ITASSETFLOW_CORS_ORIGINS=http://itassetflow.firma.local
```

Start:

```powershell
python src/web_main.py
```

Wichtig:

Visual Studio Code muss dafür **nicht** geöffnet sein. Es muss lediglich der Python-Prozess laufen.

Für einen produktiven Dauerbetrieb sollte `web_main.py` später als Windows-Dienst oder über einen vergleichbaren automatischen Startmechanismus betrieben werden.

---

## 5. Port 8000 freigeben

Da IIS in dieser Konfiguration nur React ausliefert und der Browser die FastAPI-API direkt auf Port 8000 aufruft, muss Port 8000 vom Client erreichbar sein.

Firewall-Regel auf dem Server:

```powershell
New-NetFirewallRule `
  -DisplayName "ITAssetFlow Backend" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8000 `
  -Action Allow
```

API-Test vom Client:

```text
http://itassetflow.firma.local:8000/api/health
```

Erwartete Antwort:

```json
{
  "status": "ok",
  "application": "ITAssetFlow"
}
```

---

## 6. Webanwendung öffnen

Frontend:

```text
http://itassetflow.firma.local
```

Da die IIS-Version ohne URL-Rewrite-Erweiterung betrieben wird, verwendet React einen `HashRouter`.

Daher sehen interne React-Routen zum Beispiel so aus:

```text
http://itassetflow.firma.local/#/login
http://itassetflow.firma.local/#/inventory
http://itassetflow.firma.local/#/settings
```

Der Benutzer muss die Hash-Route nicht manuell eingeben.

Normalerweise reicht:

```text
http://itassetflow.firma.local
```

React übernimmt anschließend die Navigation.

Der HashRouter ist in dieser Architektur bewusst gewählt, da IIS dadurch keine virtuellen React-Routen wie `/login` oder `/inventory` auf `index.html` umschreiben muss.

---

# IIS und FastAPI – Datenfluss

Beim Login sieht der Ablauf zum Beispiel so aus:

```text
Benutzer öffnet
http://itassetflow.firma.local
        │
        ▼
IIS liefert React aus
        │
        ▼
Browser zeigt Login
        │
        │ POST /api/auth/login
        ▼
http://itassetflow.firma.local:8000
        │
        ▼
FastAPI
        │
        ▼
Supabase Auth
        │
        ▼
Benutzersitzung / Inventar
```

---

# HTTPS

Für einen ersten internen Test kann HTTP verwendet werden.

Für den späteren Produktivbetrieb wird HTTPS empfohlen.

Bei HTTPS:

```env
ITASSETFLOW_COOKIE_SECURE=true
```

Außerdem muss `ITASSETFLOW_CORS_ORIGINS` auf die HTTPS-Adresse angepasst werden:

```env
ITASSETFLOW_CORS_ORIGINS=https://itassetflow.firma.local
```

---

# Typische Fehler beim Web-Deployment

## `404 - File or directory not found`

Prüfen:

- IIS Physical Path zeigt direkt auf den Ordner mit `index.html`
- `index.html` ist als Default Document aktiviert
- die IIS-Bindung besitzt den richtigen Hostnamen
- bei IIS ohne Rewrite wird `HashRouter` verwendet

## `Failed to fetch` beim Login

Prüfen:

- `web_main.py` läuft
- Port 8000 ist vom Client erreichbar
- `/api/health` funktioniert
- CORS enthält die exakte IIS-Adresse
- FastAPI wurde nach einer `.env`-Änderung neu gestartet

## `OPTIONS /api/auth/login 400 Bad Request`

Dies ist normalerweise ein CORS-Preflight-Problem.

Beispiel:

```env
ITASSETFLOW_CORS_ORIGINS=http://itassetflow.firma.local
```

Danach FastAPI neu starten.

## Weiße Webseite

Browser-Entwicklertools öffnen und prüfen, ob JavaScript- und CSS-Dateien aus `/assets` mit HTTP 200 geladen werden.

---

# Native Anwendung als EXE bereitstellen

Die native PySide6-Anwendung kann als Windows-Anwendungsordner exportiert werden.

Für ITAssetFlow ist ein **One-Directory-Build** sinnvoller als eine einzelne One-File-EXE.

Vorteile:

- schnellerer Programmstart
- PySide6-Abhängigkeiten liegen normal im Programmordner
- Fehler lassen sich leichter nachvollziehen
- zusätzliche Ressourcen können einfacher mitgeliefert werden
- weniger Probleme mit temporär entpackten Dateien

VS Code besitzt dafür keine eigene EXE-Exportfunktion. Der Build kann aber direkt im integrierten VS-Code-Terminal mit **PyInstaller** durchgeführt werden.

---

## PyInstaller installieren

Im Projektordner:

```powershell
python -m pip install pyinstaller
```

---

## EXE-Ordner erzeugen

Aus dem Projektstamm:

```powershell
python -m PyInstaller `
  --noconfirm `
  --clean `
  --windowed `
  --onedir `
  --name ITAssetFlow `
  --paths src `
  src/main.py
```

Danach entsteht:

```text
dist/
└── ITAssetFlow/
    ├── ITAssetFlow.exe
    └── _internal/
```

Start:

```text
dist\ITAssetFlow\ITAssetFlow.exe
```

Die gesamte `ITAssetFlow`-Directory muss weitergegeben werden, nicht nur die einzelne `.exe`.

---

## Logo und zusätzliche Dateien

Falls die native Anwendung Dateien wie `logo.png` direkt vom Dateisystem benötigt, müssen diese ebenfalls in den PyInstaller-Build aufgenommen werden.

Wenn `logo.png` beispielsweise im Projektstamm liegt:

```powershell
python -m PyInstaller `
  --noconfirm `
  --clean `
  --windowed `
  --onedir `
  --name ITAssetFlow `
  --paths src `
  --add-data "logo.png;." `
  src/main.py
```

Unter Windows verwendet PyInstaller bei `--add-data` einen Semikolon-Trenner:

```text
Quelle;Ziel
```

Weitere benötigte Ressourcen können auf dieselbe Art hinzugefügt werden.

---

## Konfiguration bei der EXE-Version

Geheime Supabase-Zugangsdaten sollten **nicht fest in die EXE eingebaut** werden.

Die Konfiguration sollte weiterhin extern über die von ITAssetFlow unterstützte `.env`- bzw. Konfigurationslogik bereitgestellt werden.

Vor der finalen Abgabe sollte einmal getestet werden:

- Start per Doppelklick auf `ITAssetFlow.exe`
- Login
- Inventar laden
- Einstellungen öffnen
- Eintrag erstellen
- Eintrag bearbeiten
- Eintrag löschen
- CSV Import/Export
- Programm schließen und erneut starten

---

# Empfohlene Form der Diplomarbeits-Abgabe

Für eine möglichst einfache Prüfung kann das Projekt in zwei Varianten bereitgestellt werden.

## 1. Quellcode

Enthält:

```text
src/
web/src/
requirements.txt
README.md
.env.example
```

Damit ist die technische Implementierung vollständig nachvollziehbar.

## 2. Testbares Paket

Zusätzlich:

```text
web/dist/
```

und optional:

```text
dist/ITAssetFlow/
└── ITAssetFlow.exe
```

Dadurch kann ein Prüfer:

### Webanwendung

```powershell
python src/web_main.py
```

starten und anschließend:

```text
http://127.0.0.1:8000
```

öffnen.

### Native Anwendung

direkt:

```text
dist\ITAssetFlow\ITAssetFlow.exe
```

starten.

Damit sind beide Benutzeroberflächen testbar, ohne dass für die Weboberfläche Node.js oder Vite installiert werden müssen.

---

# Sicherheitshinweise

- `.env` niemals in Git einchecken
- keine Supabase Service-Role-Keys im Frontend speichern
- keine Passwörter im Quellcode hinterlegen
- normale Benutzerzugriffe weiterhin über Supabase Auth und RLS absichern
- produktiv HTTPS verwenden
- Portfreigaben auf das tatsächlich benötigte interne Netzwerk beschränken
- FastAPI für den Dauerbetrieb automatisiert starten

---

# Projektstatus

ITAssetFlow befindet sich in aktiver Entwicklung.

Bereits umgesetzt bzw. laufend erweitert werden unter anderem:

- Supabase-Authentifizierung
- Inventarübersicht
- Suche und Filterung
- konfigurierbare Tabellenansichten
- Navigation und Detailansicht
- Erstellung und Bearbeitung von Inventareinträgen
- Löschen von Inventareinträgen
- CSV Import/Export
- Einstellungen
- Hersteller, Kategorien und technische Spezifikationen
- Web- und Desktop-Benutzeroberfläche
- Multiuser-Zugriff über eine zentrale Datenbank

---

# Lizenz

Dieses Projekt ist derzeit für interne und Ausbildungszwecke vorgesehen.
