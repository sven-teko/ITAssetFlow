# ITAssetFlow 1.1.1 – Update vom 29.10.2026

Basis: Branch `webapp`, Commit `35f85cdf5618da7872db551b2032feca84b20c1e`.

## Änderungen

- Navigation und Detailansicht haben einen dunkleren grauen Hintergrund und dunklere Titelzeilen.
- Die Anzahl der Datensätze steht weiterhin in der unteren Statusleiste. Die doppelte Anzeige neben Scanner entfällt.
- Neben dem Text „Abmelden“ befindet sich ein rotes Power-Symbol im selben Button. Es führt die bestehende Abmeldung aus.
- „Hilfe → Über“ zeigt Version 1.1.1, das Datum und die aktuellen Funktionen.
- Bestehende Einträge und Produktmodelle können auch geladen und ohne neue Scanner-Kennungen gespeichert werden, wenn die optionalen QR-/EAN-Spalten noch fehlen. Andere Datenbankfehler bleiben sichtbar.
- Ausgefüllte QR-/EAN-Werte werden niemals stillschweigend weggelassen. Fehlen die zugehörigen Spalten, erscheint ein verständlicher Hinweis auf das SQL-Skript.

## Einspielen

1. Den aktuellen Projektordner sichern. Den Inhalt dieses ZIP in den Projekt-Hauptordner kopieren und vorhandene Dateien ersetzen. **Auch die Backenddateien unter `src` übernehmen.** Vorhandene `.env` und Zertifikate behalten.
2. **IIS:** Den vollständigen Inhalt von `web/dist` in den physischen IIS-Webordner kopieren. Eine vorhandene `web.config` behalten. Zeigt IIS bereits direkt auf `web/dist`, entfällt das Kopieren. Das Paket benötigt keinen erneuten npm-Build und keine IIS-Weiterleitung.
3. Das Python-Backend vollständig beenden und mit `python src/web_main.py` neu starten.
4. **Render:** Änderungen im Branch `webapp` einschliesslich aller Dateien unter `web/dist/assets` committen und pushen, danach „Deploy latest commit“ wählen. Die bestehende Konfiguration für FastAPI und HTTPS beibehalten.
5. Die Webseite mit **Strg + F5** neu laden. Auf dem Handy gegebenenfalls die gespeicherten Websitedaten dieser Domain löschen. Unter **Hilfe → Über** muss **1.1.1 · 29.10.2026** stehen.

## Fehlende QR-/EAN-Spalten im DLC-Projekt

Die Fehlermeldung `column product_models.qr_code does not exist` bedeutet, dass die Anwendung bereits den Scanner-Code verwendet, die tatsächlich angesprochene Datenbank diese Erweiterung aber noch nicht hat.

Für neue QR-/EAN-Kennungen einmal den gesamten Inhalt von **`database/scanner_codes.sql`** im SQL-Editor der **DLC-Informatik-Datenbank** ausführen, die zur `SUPABASE_URL` deiner laufenden Anwendung gehört. Das Skript ergänzt optionale Spalten und Suchindizes in `assets` und `product_models`. Es ist wiederholt ausführbar und löscht keine Daten.

**Verbindungsstatus bei Erstellung dieses Pakets:** Die hier verfügbare Supabase-Verbindung bot ausschliesslich die Organisation **Sven-Teko** an. **DLC-Informatik war darüber nicht erreichbar.** Im Rahmen dieses Updates wurde keine Datenbank verändert. Für eine direkte Anpassung durch ChatGPT muss die Supabase-Verbindung mit dem DLC-Informatik-Konto ausgewählt oder neu verbunden und das Zielprojekt danach geprüft werden. Eine frühere Einrichtung in einem anderen Konto ersetzt die Erweiterung im DLC-Projekt nicht.

Mit diesem Backend-Update ist das normale Bearbeiten auch vor Ausführung des Skripts möglich, solange keine neuen Scanner-Kennungen gespeichert werden sollen.

## Eigener Build bei späteren Quelländerungen

```powershell
cd web
npm.cmd ci
npm.cmd run build -- --emptyOutDir
```

Der mitgelieferte Build verwendet auf `*.onrender.com` die API derselben Origin und beim direkten IIS-Betrieb den Hostnamen sowie das Protokoll der Webseite auf Port 8000. Ein beim eigenen Build gesetztes `VITE_API_BASE_URL` überschreibt diese Auswahl.

## Prüfung

60 Python-Tests mit isolierten Datenbankzugriffen prüfen unter anderem den gemeldeten Fehler, das Laden und Speichern ohne Scanner-Spalten sowie vorhandene QR-/EAN-Daten. TypeScript/Vite und ESLint wurden geprüft. Beide Browser-Testskripte gegen den fertigen Build waren erfolgreich, einschliesslich der neuen Oberflächenangaben, mobiler Ansicht, Scanner und Kontextmenü. Alle Browserprüfungen verwenden Testdaten. Änderungen an der produktiven DLC-Datenbank und ein Live-Test dort stehen bis zur korrekten Verbindung aus.
