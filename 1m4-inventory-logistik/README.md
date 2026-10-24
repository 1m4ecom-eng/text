# 1M4 Inventory – Logistik-Buchung und externe Bestandsansicht

Apps-Script-Code für die Google-Tabelle „1M4 Inventory“ (Sheetify Inventory + LOT-Erweiterung).

| Ordner | Ziel | Läuft als |
|---|---|---|
| `logistik-buchung/` (Logistik_Logic.gs, Logistik_Server.gs, Logistik_Form.html, appsscript.json) | eigenes Skriptprojekt „1M4 Logistik Buchung“: Web-App für Wareneingang, Warenausgang, Korrektur | zugreifender Nutzer (Allowlist in Script Property `ALLOWED_EMAILS`) |
| `sheetify-erweiterung/Bestand_Extern.gs` | zusätzliche Datei im an die Tabelle gebundenen Sheetify-Projekt: externe read-only Bestandstabelle | Besitzer (Zeittrigger) |
| `sheetify-erweiterung/Schutz_Setup.gs` | einmalig: Schutzbereiche „nur Warnung“ für Formelspalten, Inventory, Setup, Bestand je Lager | Besitzer |
| `sheetify-erweiterung/Lager_Setup.gs` | einmalig/wiederholbar: Spalte „Lager“, Umlagerungstypen, LOT-Formeln je Lager, Tab „Bestand je Lager“ | Besitzer |
| `sheetify-erweiterung/Lager_Migration.gs` | `MIG_dryRun` (Bericht) / `MIG_apply` (füllt nur leere Lager-Zellen) | Besitzer |
| `sheetify-erweiterung/LotTracking.gs` | LOT-Zuordnung (onEdit, Menü „🏷️ LOT“), lagerbewusst | Besitzer |
| `tests/` | `node tests/run_tests.js` (Logik), `node tests/server_mock_test.js` (Server gegen Tabellen-Mock), `node tests/lager_setup_mock_test.js` (erzeugte Formeln) | – |

Wichtige Regeln (aus der Analyse der Tabelle):
- Bestand und LOT-Restbestand werden über Formeln berechnet; der Warenausgang zählt nur mit Status `Setup!G11` („🚚 Shipped“), der Eingang nur mit „✅ Received“ und „Recieved QTY“.
- Sales-Spalte „LOT“ im Format `LOT (Menge); LOT2 (Menge)`, fehlender Bestand als `OHNE LOT (n)` (kompatibel mit `LotTracking.gs` und der Formel in `LOTs!J`).
- Neue Zeilen in Sales/Purchases/Correction vor Zeile 7; Formeln, Format und Validierung werden aus der Zeile darunter übernommen (die Sheetify-Funktionen `addSale`/`addPurchase` nutzen veraltete Spaltennummern).
- Spalten werden ausschließlich über die Kopfzeile (Zeile 5) aufgelöst.

Einspielen und Testen: `PROMPT_Phase2_Einspielen_und_Testen.md`, `PROMPT_Phase3_Mehrlager_Portal.md` (Mehrlager, Bestandsansicht, Rollen/Portal).
