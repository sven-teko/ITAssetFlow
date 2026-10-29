# ITAssetFlow – Scanner-Update vom 22.10.2026

Basis: GitHub-Branch `webapp`, Commit `9fe12475af31c40c37483676869aa54fc9cab188`.
Build-Kennung: `2026-10-22-scanner-v2`.

## Enthalten

- Die Funktion heisst **Scanner** und liest QR-Codes, EAN-8 und EAN-13 über Kamera, Bilddatei oder manuelle Eingabe.
- QR-Code und EAN sind unabhängige, optionale Felder. Artikel können einen, beide oder keinen dieser Codes besitzen. EAN bleibt Text, damit führende Nullen erhalten bleiben. Länge und Prüfziffer werden geprüft.
- Einzelgeräte: Kennungen im Artikelformular. Die interne Produkterkennung und Seriennummer bleiben getrennt. Ein unbekannter EAN-Code füllt ausschliesslich das EAN-Feld vor.
- Mengenartikel: Kennungen gelten für das Produktmodell an allen Lagerorten. Sie sind im Artikelformular sowie unter **Einstellungen → Produktmodelle** bearbeitbar. Beim Erfassen eines weiteren Bestands werden vorhandene Modellkennungen nicht überschrieben.
- Bestehende Asset-Tags, Seriennummern, SKU und Artikelnummern werden weiterhin erkannt. Bei mehreren Treffern muss der passende Eintrag ausgewählt werden.
- Bekannte Mengenartikel: Bestand erhöhen/reduzieren mit den bisherigen Lagerbuchungen. Einzelgeräte: bearbeiten/löschen.
- Smartphone im Hochformat mit Touchbedienung: **Filter | Tabelle | Details**, Startansicht **Tabelle**. Wechsel durch Antippen oder horizontales Wischen. Innerhalb einer breiten Tabelle hat horizontales Scrollen Vorrang; am Tabellenrand oder auf der Kopf-/Statuszeile wird der Tab gewechselt. Ein schmales PC-Fenster mit Maus verwendet weiterhin Seitenleisten.
- Rechtsklick oder etwa eine halbe Sekunde langes Drücken auf einer Tabellenzeile: **Eintrag bearbeiten / Eintrag löschen**. Scrollbewegungen brechen das lange Drücken ab. Löschen verlangt weiterhin eine Bestätigung.

## Einspielen

1. Aktuellen Projektordner und IIS-Webordner sichern.
2. Den Inhalt dieses ZIP in den Projekt-Hauptordner kopieren und Dateien ersetzen. Auch `src` übernehmen: Der Scanner benötigt die neuen Backend-Endpunkte.
3. Die optionalen Spalten wurden in der verbundenen Supabase-Datenbank **ITAssetFlow** bereits eingerichtet. Nur bei Verwendung einer weiteren Datenbank dort zuerst `database/scanner_codes.sql` ausführen. Vorhandene Daten und Berechtigungen werden durch dieses Skript nicht geändert.
4. Python-Backend beenden und mit `python src/web_main.py` neu starten. Vorhandene `.env` und Zertifikate behalten. Für die Kamera muss die Webseite vertrauenswürdiges HTTPS verwenden. Beim direkten IIS/API-Betrieb muss auch die API auf Port 8000 per HTTPS erreichbar sein.
5. **IIS:** Den gesamten Inhalt von `web/dist` in den physischen IIS-Webordner kopieren. Eine vorhandene `web.config` behalten. Wenn IIS direkt auf `web/dist` zeigt, entfällt das Kopieren.
6. **Render:** Im Branch `webapp` Quelländerungen und den vollständigen Ordner `web/dist` einschliesslich aller Dateien unter `assets` committen und pushen. Dann **Deploy latest commit** wählen. Ein neuer npm-Build ist für dieses Paket nicht nötig.

```powershell
git add src web/src web/index.html web/package.json web/package-lock.json database tests UPDATE-SCANNER.md
git add -f web/dist
git commit -m "Scanner mit QR und EAN sowie mobile Tabs ergänzen"
git push origin webapp
```

7. PC: **Strg + F5**. Handy: Tab schliessen und neu öffnen, gegebenenfalls die gespeicherten Websitedaten dieser Domain löschen. Android-Kameraberechtigung beim ersten Start erlauben. Es muss jetzt **Scanner** angezeigt werden.

Der mitgelieferte Build verwendet auf `*.onrender.com` die API derselben Origin. Für IIS verwendet er automatisch das Protokoll und den Hostnamen der Webseite mit Port 8000. Er benötigt keine IIS-Weiterleitung. Bereits laufende Deployments werden durch das Herunterladen dieses ZIP nicht aktualisiert.

## Später selbst bauen

```powershell
cd web
npm.cmd ci
npm.cmd run build -- --emptyOutDir
```

Ein vorhandener Eintrag `VITE_API_BASE_URL` in `.env.production` oder den Build-Umgebungsvariablen überschreibt die automatische Auswahl. Für Render kann der Wert leer bleiben. Für direktes IIS-HTTPS ist beispielsweise `https://itassetflow.dlc-informatik.local:8000` passend. Den kompletten neu erzeugten `dist` gemeinsam übernehmen.

## Prüfung

50 Python-Regressionstests, TypeScript/Vite-Build, ESLint und Browserregressionen mit isolierter Test-API. Geprüft wurden echte QR-/EAN-Bilddateien, QR/EAN in simulierten Kamerastreams, Freigabe der Kameratracks, Mehrfachtreffer, führende Nullen, unbekannte Codes, Bestandsbuchungen, Rechte, Kontextmenü sowie Touch-Hochformat bei 360/390 Pixel Breite. Der fertige Build wurde über das Python-Backend auf vollständige statische Dateien geprüft. Die Datenbankspalten und vorhandenen RLS-Einstellungen wurden nach der Erweiterung kontrolliert.

Die Browserprüfungen verwenden Testdaten. Ein produktiver Buchungstest und Tests mit physischen Android-/Windows-Kameras wurden nicht durchgeführt.
