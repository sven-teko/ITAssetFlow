# Regressionstests

Im Projekt-Hauptordner, mit installierten Python-Abhängigkeiten:

```powershell
python -m unittest discover -s tests -v
```

Die Tests verwenden simulierte Datenbankzugriffe. Sie verändern keine produktiven Daten.

`browser_smoke.cjs` prüft Anmeldung, Statusfilter, Mitarbeiterverwaltung, Garantie und Ladeansichten mit simulierten API-Antworten. Es benötigt Playwright samt Chromium. Playwright kann im Ordner `web` installiert sein. Bei laufendem Vite ist der Aufruf `node tests/browser_smoke.cjs` im Projekt-Hauptordner möglich. Mit der Umgebungsvariable `START_VITE=1` startet das Skript den Entwicklungsserver selbst.

`browser_qr_mobile.cjs` prüft Mitarbeiter ohne E-Mail, sichtbare Dockziele und Leistenreihenfolge, unbekannte QR-Kennungen, echten QR-Decoder mit `fixtures/QR-CABLE.png` und einem daraus erzeugten Kamerastream, Freigabe der Kamera-Tracks, Bestandsbuchungen bis null, unklare Buchungsantworten, Leserrechte sowie Smartphoneansichten bei 390 und 360 Pixel Breite, Wischgesten, langes Drücken und Rechtsklick. Zusätzlich werden echte EAN-8-/EAN-13-Bilder und ein EAN-Kamerastream, optionale Codefelder, führende Nullen sowie mehrere Treffer geprüft. Auch dieses Skript kann mit `START_VITE=1` starten. Es benötigt keine reale Kamera und verwendet keine produktiven Daten.

Beispiel in PowerShell nach Installation der Testwerkzeuge:

```powershell
$env:START_VITE = "1"
node tests/browser_smoke.cjs
node tests/browser_qr_mobile.cjs
```

Für den Test des fertigen Builds zunächst `npm.cmd run build -- --emptyOutDir` und `npm.cmd run preview -- --host 127.0.0.1 --port 5173` im Ordner `web` starten. In einem zweiten Terminal die Testskripte ohne `START_VITE` ausführen. Die API-Aufrufe werden vom Test abgefangen.

Für ein anderes Testziel kann `UI_BASE_URL` gesetzt werden. `PLAYWRIGHT_MODULE` und `CHROMIUM_EXECUTABLE` sind optionale Pfade für bestehende Testumgebungen.

`test_scanner.py` prüft optionale QR-/EAN-Kennungen, Prüfziffern, Mehrfachtreffer, Bestand über EAN, Altschnittstellen und Rechte. Alle Buchungen in den Tests verwenden simulierte Daten.

`test_scanner_schema.py` prüft die fehlenden optionalen Spalten (42703/PGRST204), das Laden und Speichern bestehender Einträge mit altem Schema, teilweise ergänzte Datenbanken und den Schutz vor verworfenen QR-/EAN-Werten. Der gesamte Python-Testlauf enthält 60 Tests.

Die Browser-Smoke-Prüfung kontrolliert zusätzlich die dunkleren Seitenleisten, die Datensatzanzahl nur unten, das rote Power-Symbol und die aktualisierten Angaben unter Hilfe → Über. Mit `START_PREVIEW=1` starten beide Browser-Testskripte den fertigen dist-Build selbst.
