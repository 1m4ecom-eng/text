# Auftrag: 1M4 Logistik-Buchung in der TEST-Kopie einspielen und testen (Phase 2)

## Kontext
- Browser angemeldet als **1m4.ecom@gmail.com** (Besitzer). Code-Dateien liegen lokal unter
  `C:\Users\hr\Claude\Temp\Logistik_Code\` (entpacktes ZIP „1m4-inventory-logistik“).
- TEST-Tabelle „1M4 Inventory – TEST“:
  https://docs.google.com/spreadsheets/d/1Vm_exwwkdNUawOEU_3kW8re-fqn29VaWd1KbsgLfBD0/edit
  (bereits vorbereitet: Inventory-Spalte Z „LOT-Pflicht“, Tab „Buchungslog“)
- **Live-Tabelle „1M4 Inventory“ (1-Qxe4uK1X-…) NICHT öffnen, NICHT ändern.**

## Regeln
- Nur die TEST-Tabelle, ihr gebundenes Skriptprojekt und das neue Projekt „1M4 Logistik Buchung“ bearbeiten.
- Keine Sheetify-Menüpunkte ausführen (insbesondere NICHT „Add Sale/Add Purchase/Add Inventory“ – die schreiben Formeln in falsche Spalten).
- Keine E-Mails senden, keine Freigaben (Sharing) setzen, keine Dateien außerhalb dieses Auftrags anlegen/löschen.
- Bei Fehlern: Meldung wörtlich notieren, nicht improvisieren, im Protokoll festhalten.
- Ergebnisse lokal speichern: `C:\Users\hr\Claude\Output\Phase2_Testprotokoll.md` (+ Screenshots im selben Ordner).

## Schritt 1 – Gebundenes Skript der TEST-Kopie prüfen und Zeitzone
1. TEST-Tabelle → Erweiterungen → Apps Script. Prüfen, dass das Projekt die Dateien `Code.gs` und `LotTracking.gs` enthält (Projektname notieren).
   Falls KEIN Skript vorhanden ist: STOPP, im Protokoll vermerken.
2. Projekteinstellungen → Zeitzone auf **(GMT+02:00/+03:00) Osteuropäische Zeit – Helsinki** stellen, speichern.
3. Neue Skriptdateien `Bestand_Extern` und `Schutz_Setup` anlegen, Inhalt 1:1 aus `sheetify-erweiterung\Bestand_Extern.gs` bzw. `Schutz_Setup.gs` einfügen, speichern.
4. Projekteinstellungen → Skripteigenschaften: `BE_EXTERNAL_ID` = `16ZBRmWUyimB615UFwalt9nawDhbKpsafRi-XdKPA3kU`
   (externe Testdatei „1M4 Bestand extern – TEST“, Ordner „1M4 Inventory“).
5. Funktion `SCHUTZ_setup` auswählen → Ausführen (Autorisierung als 1m4.ecom bestätigen). Erwartet: Toast „… Schutzbereiche (nur Warnung) gesetzt“. In der Tabelle unter Daten → Geschützte Tabellenblätter und Bereiche prüfen.
6. Funktion `BE_install` ausführen. Erwartet: zwei Zeittrigger (BE_refresh stündlich, BE_checkPending alle 10 Minuten) und die externe Testdatei enthält Tab „Bestand“ mit „Stand: …“, Spalten Artikelnummer (SKU) / EAN / Produktname / Bestand.
7. Trigger der TEST-Kopie: In der Trigger-Liste prüfen, dass nur die beiden BE-Trigger existieren (Kopien übernehmen keine Trigger). `LOT_install` NICHT ausführen – die Tests sollen ohne die manuellen onEdit-Trigger laufen.

## Schritt 2 – Neues Projekt „1M4 Logistik Buchung“
1. https://script.google.com → Neues Projekt → Name „1M4 Logistik Buchung“.
2. Projekteinstellungen: Häkchen „Manifestdatei appsscript.json im Editor anzeigen“ setzen; Zeitzone Helsinki.
3. Dateien anlegen und Inhalt 1:1 aus `logistik-buchung\` einfügen:
   - `appsscript.json` (vorhandenen Inhalt komplett ersetzen)
   - `Logistik_Logic.gs` (Skript), `Logistik_Form.gs` (Skript), `Logistik_Form` (HTML-Datei, Name ohne .html)
   - die leere Standarddatei `Code.gs` löschen.
4. Projekteinstellungen → Skripteigenschaften:
   - `SPREADSHEET_ID` = `1Vm_exwwkdNUawOEU_3kW8re-fqn29VaWd1KbsgLfBD0`
   - `ALLOWED_EMAILS` = `1m4.ecom@gmail.com, 1m4.ecom2@gmail.com, h.g.w.rieger@gmail.com, sabina.rieger73@gmail.com, logistik@medi-learn.de, sabinevonmedilearn@gmail.com`
5. Projekt in Drive in den Ordner „1M4 Inventory“ verschieben (Drive → Datei „1M4 Logistik Buchung“ → Verschieben).
6. Bereitstellen → Neue Bereitstellung → Typ **Web-App**: Beschreibung „TEST v1“, Ausführen als **„Nutzer, der auf die Web-App zugreift“**, Zugriff **„Jeder mit Google-Konto“**. Bereitstellen, Autorisierung als 1m4.ecom bestätigen. Angeforderte Berechtigungen notieren (erwartet: nur Tabellen + E-Mail-Adresse). Web-App-URL notieren.

## Schritt 3 – Testdaten vorbereiten (in der TEST-Tabelle, von Hand)
- Tab LOTs: Für den Artikel „1m4 Keyboard Cover“ existiert LOT „1234“ (100 Stk.). Zusätzlich über das Formular (Testfall 1) eine LOT anlegen; danach von Hand:
  - LOT `T-FREI` (Testfall 1) Sperre auf „Frei“ setzen,
  - eine LOT `T-ALT` per Formular anlegen (Verfallsdatum gestern), Sperre „Frei“ → muss als „❌ Abgelaufen“ erscheinen,
  - LOT `T-GESP` per Formular anlegen (bleibt „Gesperrt“).

## Schritt 4 – Testfälle (Web-App-URL im Browser, Handy-Ansicht über DevTools 390 px zusätzlich prüfen)
Für jeden Fall: Eingaben, Ergebnis im Formular, betroffene Zeilen in der Tabelle (Formeln intakt? Stock On Hand / Restbestand / Status / Nächste LOT korrekt?), Eintrag im Buchungslog. Screenshot.

1. **Eingang mit neuer LOT:** Mitarbeiter Helmut, Artikel „Keyboard“ suchen, Menge 50, LOT `T-FREI`, Verfall in 2 Jahren, Lieferant vorbelegt? Referenz „PO-TEST-1“. Erwartet: LOTs neue Zeile (Sperre „Gesperrt“), Purchases neue Zeile 7 mit Status „✅ Received“, Recieved QTY 50, Notes enthält „Ref: PO-TEST-1“; Inventory Stock On Hand +50. Formeln in Purchases-Zeile 7 (SKU, Difference, Total Cost, Shipping Days) vorhanden.
2. **Eingang mit vorhandener LOT:** gleicher Artikel, LOT `T-FREI`, Menge 10. Erwartet: Rückfrage „LOT existiert bereits…“; nach „Trotzdem buchen“ KEINE neue LOT-Zeile, Menge Eingang der LOT = 60.
3. **Ausgang mit FEFO-Vorschlag:** Mitarbeiter Doris, LS-Nr. „LS-TEST-1“, Menge 5. Erwartet: Vorschlagstabelle zeigt nur auswählbare LOTs (nicht `T-GESP`, nicht `T-ALT`), Reihenfolge nach Verfall; nach Buchung Sales Zeile 7: Status „🚚 Shipped“, LS No., LOT-Text „… (5)“, Sale Price/Profit per Formel befüllt (im Formular NICHT sichtbar); LOTs Ausgang Verkauf erhöht.
4. **Ausgang ohne LS-Nr.:** muss blockiert werden (Meldung, keine Zeile).
5. **Ausgang über Bestand:** Menge größer als Stock On Hand. Erwartet: Warnung, erst nach „Trotzdem buchen“ Buchung; LOT-Text enthält „OHNE LOT (n)“.
6. **Korrektur (+):** Sabina, Typ (+), Menge 3, LOT `T-FREI`, Begründung „Zählung“. **Korrektur (−):** Menge 2, LOT `1234`, Begründung „Bruch“. Ohne Begründung → blockiert. Erwartet: Correction-Zeilen mit Typ-Text aus Setup, LOTs-Spalte Korrektur ±, Stock On Hand ±.
7. **Gesperrte LOT:** `T-GESP` erscheint im Warenausgang nicht in der LOT-Tabelle.
8. **Gleichzeitige Buchungen:** Web-App in zwei Fenstern öffnen (zweites Fenster gleiches Konto genügt), in beiden einen Warenausgang vorbereiten und möglichst gleichzeitig „Buchen“ klicken. Erwartet: beide Buchungen in eigenen Zeilen, keine überschriebenen Werte, zwei Log-Einträge.
9. **Zugriffsschutz:** Web-App-URL in einem Inkognito-Fenster mit einem NICHT gelisteten Google-Konto öffnen (falls verfügbar) → „Kein Zugriff“. Sonst als „nicht getestet“ notieren.
10. **Kontrolle:** Menü „🏷️ LOT“ → „Prüfung: SKU-Bestand vs. LOT-Bestand“ ausführen (nur Anzeige) und Ergebnis notieren.
11. **Externer Bestand:** Im Skripteditor der TEST-Kopie `BE_refresh` ausführen (oder 10 Minuten nach der letzten Buchung warten). In „1M4 Bestand extern – TEST“ prüfen:
    - „Stand:“ aktuell; keine Materialien (z. B. 80004.01), keine 8000x-Bauteile, kein EH 157 / EH 193 / 12000.99; ML Cards enthalten; Artikel mit EAN „n/a“ haben leere EAN.
    - Bestand „1m4 Keyboard Cover“ = Stock On Hand minus Restbestand von `T-GESP` und `T-ALT`.
    - Keine LOT-Details, Preise, Lieferanten oder Notizen sichtbar; Formeln/IMPORTRANGE: keine (Zellen enthalten reine Werte).
12. **Schutz-Warnung:** In der TEST-Tabelle von Hand in Sales Spalte „SKU“ einer leeren Zeile tippen → Warnhinweis muss erscheinen → „Abbrechen“. Danach erneut eine Formularbuchung (Warenausgang) → muss ohne Fehler durchlaufen.

## Ergebnis
`Phase2_Testprotokoll.md` mit: Web-App-URL, angeforderte Berechtigungen, je Testfall Soll/Ist/OK-NOK, Fehlermeldungen wörtlich, Zeilennummern, Screenshot-Dateinamen. Danach STOPP.
