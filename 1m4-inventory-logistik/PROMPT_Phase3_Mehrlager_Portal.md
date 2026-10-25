# Auftrag (Cowork): 1M4 Inventory – Mehrlager, Bestandsansicht und Portal in der TEST-Kopie einspielen und testen (Phase 3)

Dieses Dokument ist vollständig: Konzept, Anleitung, Testfälle oben, alle Code-Dateien im ANHANG. Arbeite die Schritte der Reihe nach ab und STOPPE nach dem Testprotokoll.

> **Version 3 (25.10.2026) – FORTSETZUNG, nicht von vorne beginnen.**
> Lauf v2 stoppte in Schritt 2.8: Im Tab „Bestand je Lager“ war die Abweichung ≠ 0 (−17 bei fast allen Artikeln). Ursache: SUMMEWENNS rechnet in ARRAYFORMULA nicht zeilenweise. Korrigiert in **Anhang B4** (`Lager_Setup.gs`): Die Lagerspalten rechnen jetzt mit MAP/LAMBDA je Artikel. Die neue Formel wurde bereits direkt in der TEST-Tabelle geprüft: Abweichung bei allen 278 Artikeln = 0 (Keyboard Cover 83, Privatrezepte 495). Alle anderen Anhänge sind unverändert.
>
> **Stand der TEST-Tabelle:** Schritte 1 bis 2.7 aus Lauf v2 sind erledigt (Spalte „Lager“, Umlagerungstypen, LOT-Formeln, Migration: 21 Zeilen = Medi-Learn). **Nicht zurücksetzen.**
>
> **In diesem Lauf genau so vorgehen:**
> 1. Schritt 1 entfällt. Ausgangswerte sind bekannt: Keyboard Cover Stock On Hand 83; LOTs 1234 Rest −2, T-FREI 0, T-ALT 20, T-GESP 15, 1230 100.
> 2. Schritte 2.1 bis 2.3 entfallen (bereits erledigt und geprüft).
> 3. Schritt 2.4: **nur `Lager_Setup` durch Anhang B4 (Version 3) ersetzen** (enthält `MAP(` und `LAMBDA(artikel`), speichern, Zeilenzahl prüfen. `Lager_Migration` bleibt.
> 4. Schritt 2.5: `LAGER_setup` erneut ausführen. Das ist wiederholbar: Spalten und Typen werden nicht doppelt angelegt. Erwartetes Protokoll: Trennzeichen „;“, Lager, LOT-Formeln gesetzt, Tab aufgebaut, **keine** Zeilen „angelegt“ für Spalten oder Typen.
> 5. Schritt 2.6: `MIG_dryRun` → erwartet „Zuzuordnen: 0 · Unklar: 0 · Bereits gesetzt: 21“. Schritt 2.7 (`MIG_apply`) entfällt.
> 6. Ab **Schritt 2.8** wie beschrieben weiter (Abweichung überall 0), dann 2.9, Schritt 3 und alle Testfälle in Schritt 4.
> 7. Protokoll: `Phase3_Testprotokoll_v3.md`, Screenshots mit Präfix `P3v3_`.

## Kontext
- Browser angemeldet als **1m4.ecom@gmail.com** (Besitzer), **nur dieses eine Google-Konto im Browser** (mehrere Konten blockieren die Web-App).
- TEST-Tabelle „1M4 Inventory – TEST“: https://docs.google.com/spreadsheets/d/1Vm_exwwkdNUawOEU_3kW8re-fqn29VaWd1KbsgLfBD0/edit
- Externe Testdatei „1M4 Bestand extern – TEST“: https://docs.google.com/spreadsheets/d/16ZBRmWUyimB615UFwalt9nawDhbKpsafRi-XdKPA3kU/edit
- Web-App-Projekt „1M4 Logistik Buchung“ (Ordner „02 I 1M4 Extern › 1M4 Inventory“), bereitgestellt in Phase 2.
- **Live-Tabelle „1M4 Inventory“ (1-Qxe4uK1X-…) und die Live-Datei „1M4 Bestand extern“ (1ZyuYfzc…) NICHT öffnen, NICHT ändern.**
- Code im ANHANG jeweils **exakt 1:1** übernehmen (ohne die Zeilen mit den vier Backticks). Nichts kürzen oder „verbessern“. Nach dem Einfügen speichern, auf Syntaxfehler achten, Zeilenzahl mit der Angabe im Anhang vergleichen.

## Regeln
- Keine Sheetify-Menüfunktionen (Add Sale/Purchase/Inventory). Keine E-Mails, keine Freigaben (Sharing), keine Dateien außerhalb dieses Auftrags anlegen/löschen.
- Fehler wörtlich protokollieren, nicht improvisieren. Wenn ein Schritt scheitert: STOPP und im Protokoll festhalten.
- Ergebnis: `C:\Users\hr\Claude\Output\Phase3_Testprotokoll_v3.md` + Screenshots im selben Ordner (Dateinamen mit Präfix `P3v3_`).

## Konzept (freigegeben)
- **Lager** kommt aus Setup „Warehouse“ (Medi-Learn, Medichem, Medbuy). Neue Spalte **„Lager“** am rechten Rand von Sales (O), Purchases (R), Correction (O), LOTs (P).
- **LOT-Zeilen sind lagergebunden**: dieselbe LOT in zwei Lagern = zwei Zeilen. LOT-Formeln „Ausgang Verkauf“, „Korrektur (+/−)“, „Nächste“ rechnen zusätzlich je Lager.
- **Umlagerung**: Korrekturtypen „🔁 Umlagerung (−)/(+)“ (neu in Setup) – je LOT-Anteil eine Zeile im Quell- und im Ziellager, gleiche Buchungs-ID; fehlende LOT-Zeile im Ziellager wird mit Menge Eingang 0, gleichem Verfall und gleicher Sperre angelegt. LS-Nr. optional. Der Sheetify-Gesamtbestand („Stock On Hand“) bleibt bei Umlagerungen unverändert.
- **Tab „Bestand je Lager“** (nur Formeln): Bestand je Lager, Gesamt, Stock On Hand, **Abweichung (muss 0 sein)**.
- **Migration**: leere Lager-Zellen = Inventory „Warehouse“ des Artikels; Trockenlauf zuerst, nie überschreiben.
- **Portal**: Startseite mit Kacheln Bestand / Buchen (Eingang, Ausgang, Korrektur, Umlagern) / Buchungslog / Backend (nur Admin). Rollen über Skripteigenschaften VIEW/BOOK/ADMIN, serverseitig geprüft. Lager im Formular = zuletzt gewähltes Lager.
- Externe Bestandsansicht: Gesamtbestand wie bisher (unverändert).

## Schritt 1 – Ausgangswerte notieren (TEST-Tabelle, nur lesen)
Für „1m4 Keyboard Cover“ notieren und ins Protokoll schreiben:
- Inventory: Stock On Hand, Nächste LOT, Ohne LOT.
- LOTs: jede Zeile dieses Artikels mit LOT, Menge Eingang, Ausgang Verkauf, Korrektur, Restbestand, Status, Nächste.
- Screenshot des LOTs-Tabs.

## Schritt 2 – Sheetify-Projekt der TEST-Kopie (Erweiterungen → Apps Script)
1. Sicherung der ursprünglichen `LotTracking.gs` liegt bereits vor (`C:\Users\hr\Claude\Temp\LotTracking_vorPhase3.gs.txt`, SHA-256 beginnt mit `130550b545157d89`). **Nicht überschreiben.** Nur prüfen, dass die Datei existiert.
2. `LotTracking.gs`: Inhalt komplett durch **Anhang B6** ersetzen, speichern.
3. `Schutz_Setup.gs`: Inhalt komplett durch **Anhang B7** ersetzen, speichern.
4. Skriptdateien `Lager_Setup` (**Anhang B4**) und `Lager_Migration` (**Anhang B5**) anlegen bzw. Inhalt komplett ersetzen. Speichern. (Fortsetzung v3: siehe Kasten oben – nur B4 ersetzen.)
5. In der Funktionsauswahl oben **`LAGER_setup`** auswählen (prüfen, dass sie wirklich ausgewählt ist) und ausführen. Ausführungsprotokoll abschreiben. Erwartet:
   - Erste Protokollzeile: `Formel-Trennzeichen der Tabelle: ";"`. Ein Tab `_lager_probe_…` taucht höchstens kurz auf und ist danach wieder weg.
   - Spalte „Lager“ in Sales O, Purchases R, Correction O, LOTs P (Kopf in Zeile 5, Auswahlliste mit den 3 Lagern).
   - Setup unter „Correction Type“: „🔁 Umlagerung (+)“ (1) und „🔁 Umlagerung (−)“ (−1).
   - Neuer Tab „Bestand je Lager“ mit Spalten Item, SKU, Medi-Learn, Medichem, Medbuy, Gesamt, Stock On Hand, Abweichung.
   - In LOTs keine Fehlerwerte (#ERROR!, #N/A, #VALUE!) in den Spalten Ausgang Verkauf / Korrektur / Restbestand / Status / Nächste.
6. **`MIG_dryRun`** ausführen → Tab „Migration_Bericht“ prüfen: Anzahl „zuzuordnen“, „unklar“ (erwartet 0), „bereits gesetzt“. Screenshot.
   Falls „unklar“ > 0: STOPP, Bericht ins Protokoll.
7. **`MIG_apply`** ausführen → Bericht „ANGEWENDET“. Danach **`MIG_dryRun`** erneut → erwartet „Zuzuordnen: 0“ (Wiederholbarkeit).
8. Kontrolle nach Migration (Screenshot):
   - LOTs-Werte von „1m4 Keyboard Cover“ = Ausgangswerte aus Schritt 1 (Restbestand, Ausgang, Korrektur unverändert).
   - Inventory Stock On Hand unverändert.
   - „Bestand je Lager“: Keyboard Cover Medi-Learn = Stock On Hand, Medichem/Medbuy 0, **Abweichung überall 0** (Filter auf Abweichung ≠ 0 → keine Zeile).
9. **`SCHUTZ_setup`** ausführen (jetzt inkl. „Bestand je Lager“). Erwartet: Toast „… Schutzbereiche (nur Warnung) gesetzt“.

## Schritt 3 – Web-App-Projekt „1M4 Logistik Buchung“
1. Dateien ersetzen (Inhalt komplett): `Logistik_Logic.gs` ← **Anhang B1**, `Logistik_Server.gs` ← **Anhang B2**, HTML-Datei `Logistik_Form` ← **Anhang B3**. `appsscript.json` bleibt unverändert.
2. Projekteinstellungen → Skripteigenschaften (vorhandene `SPREADSHEET_ID` bleibt):
   - `ADMIN_EMAILS` = `1m4.ecom@gmail.com, h.g.w.rieger@gmail.com, sabina.rieger73@gmail.com`
   - `BOOK_EMAILS` = `1m4.ecom2@gmail.com, logistik@medi-learn.de, sabinevonmedilearn@gmail.com`
   - `VIEW_EMAILS` = (leer lassen bzw. nicht anlegen)
   - `ALLOWED_EMAILS` löschen (ist durch BOOK/ADMIN ersetzt).
   - `ADMIN_LINKS` = alle Links in **einer** Zeile, Einträge mit `;` getrennt, je Eintrag `Bezeichnung | URL` (die beiden Projekt-IDs aus den jeweiligen Projekteinstellungen einsetzen):
     ```
     Tabelle 1M4 Inventory – TEST | https://docs.google.com/spreadsheets/d/1Vm_exwwkdNUawOEU_3kW8re-fqn29VaWd1KbsgLfBD0/edit; Externe Bestandsdatei – TEST | https://docs.google.com/spreadsheets/d/16ZBRmWUyimB615UFwalt9nawDhbKpsafRi-XdKPA3kU/edit; Skriptprojekt Sheetify (TEST) | https://script.google.com/home/projects/<ID des TEST-Sheetify-Projekts>/edit; Skriptprojekt 1M4 Logistik Buchung | https://script.google.com/home/projects/<ID dieses Projekts>/edit; Ordner 1M4 Inventory | https://drive.google.com/drive/folders/1TT9PP_S8iR-R_OmScyZdtQs-FyWEpYTy
     ```
3. Bereitstellen → **Bereitstellungen verwalten** → bestehende Web-App-Bereitstellung bearbeiten (Stift) → Version „Neue Version“, Beschreibung „TEST v2 Mehrlager“ → Bereitstellen. Die URL bleibt gleich. Falls neue Berechtigungen abgefragt werden: notieren (erwartet: keine neuen).

## Schritt 4 – Testfälle (Web-App-URL; zusätzlich Handy-Ansicht 390 px über DevTools)
Für jeden Fall: Eingaben, Ergebnis, betroffene Zeilen (Formeln intakt, Lager-Spalte), „Bestand je Lager“ (Abweichung 0), Buchungslog, **Dauer der Buchung in Sekunden**, Screenshot.

1. **Portal Admin:** Startseite zeigt 4 Kacheln (Bestand, Buchen, Buchungslog, Backend). Backend zeigt die Links; jeder Link öffnet das richtige Ziel.
2. **Rollen:** `ADMIN_EMAILS` vorübergehend leeren und `VIEW_EMAILS` = `1m4.ecom@gmail.com` → Web-App neu laden → nur Bestand + Buchungslog, keine Buchen-/Backend-Kachel. Dann `BOOK_EMAILS` um `1m4.ecom@gmail.com` ergänzen (VIEW bleibt) → Buchen sichtbar, Backend nicht. **Danach Eigenschaften exakt auf Schritt 3.2 zurücksetzen** und erneut laden (Admin).
3. **Bestand:** Kachel Bestand → „Keyboard“ suchen → Bestand je Lager + Gesamt, LOT-Tabelle mit Lager, Rest, Verfall, Status (T-GESP „gesperrt“, T-ALT „abgelaufen“ nur wenn Rest ≠ 0). Lagerfilter „Medichem“ → nur Medichem. Keine Preise/Kosten/Margen sichtbar.
4. **Eingang Medbuy, LOT 1234:** Mitarbeiter Helmut, Lager Medbuy, Menge 20, LOT 1234, Verfall in 2 Jahren. Erwartet: KEINE Rückfrage (LOT 1234 gibt es nur in Medi-Learn), neue LOT-Zeile 1234 / Lager Medbuy / Sperre Gesperrt; Purchases-Zeile mit Lager Medbuy; „Bestand je Lager“ Medbuy +20, Stock On Hand +20, Abweichung 0. Die LOT-Zeile 1234/Medi-Learn bleibt unverändert.
5. **Eingang gleiche LOT gleiches Lager:** Medbuy, LOT 1234, Menge 5 → Rückfrage „existiert in diesem Lager bereits“ → Trotzdem buchen → Menge Eingang der Medbuy-Zeile = 25.
6. **Ausgang je Lager:** In LOTs die Sperre der Zeile 1234/Medbuy von Hand auf „Frei“ setzen. Ausgang: Doris, Lager Medbuy, LS „LS-P3-1“, Menge 5 → FEFO-Tabelle zeigt nur Medbuy-LOTs; Buchung → Sales Lager Medbuy, LOT „1234 (5)“; LOTs: Ausgang Verkauf nur in der Medbuy-Zeile +5, Medi-Learn-Zeile unverändert.
7. **Ausgang ohne LS-Nr.** → blockiert. **Ausgang über Lagerbestand** (Lager Medichem, Menge 1) → Warnung „übersteigt den Bestand im Lager (0)“ → Abbrechen (nicht buchen).
8. **Korrektur:** Sabina, Lager Medi-Learn, Typ (−), Menge 2, LOT 1234, Begründung „Bruch P3“ → nur LOT-Zeile 1234/Medi-Learn Korrektur −2. In der LOT-Auswahl stehen nur LOTs des gewählten Lagers. Nach der Buchung ist die LOT-Liste leer (Fehler aus Phase 2 behoben). Der Typ „Umlagerung“ ist im Korrekturformular NICHT auswählbar.
9. **Umlagerung frei:** Kachel Buchen → „Umlagern“: Doris, Von Lager Medi-Learn, Nach Lager Medichem, Artikel Keyboard, Menge 5, LS leer lassen → FEFO-Vorschlag aus Medi-Learn → buchen. Erwartet: 2 Correction-Zeilen (Umlagerung − / Medi-Learn, Umlagerung + / Medichem, gleiche Buchungs-ID in Notes), neue LOT-Zeile im Ziellager (Menge Eingang 0, gleicher Verfall, gleiche Sperre), deren Restbestand 5; Quell-LOT Restbestand −5; „Bestand je Lager“ Medi-Learn −5, Medichem +5, **Gesamt und Stock On Hand unverändert**, Abweichung 0.
10. **Umlagerung gesperrte LOT:** Von Medi-Learn nach Medbuy, LOT T-GESP von Hand Menge 3 eintragen → Warnung „gesperrt – die Sperre wird mit umgelagert“ → Trotzdem buchen → neue LOT-Zeile T-GESP / Medbuy mit Sperre „Gesperrt“. **Gleiches Quell- und Ziellager** → blockiert.
11. **Buchungslog-Seite:** zeigt die Buchungen (neueste zuerst) mit Lager („Medi-Learn → Medichem“ bei Umlagerung), Filterfeld funktioniert.
12. **Externer Bestand:** im Sheetify-Projekt `BE_refresh` ausführen → externe Testdatei: Keyboard Cover = Stock On Hand minus Restbestand gesperrter/abgelaufener LOTs (alle Lager), Spalten wie bisher (SKU, EAN, Produktname, Bestand).
13. **LOT-Prüfung:** im Sheetify-Projekt `LOT_menuCheck` ausführen (bei geöffneter TEST-Tabelle) → Meldung abschreiben (Doppelte LOT darf nur gemeldet werden, wenn LOT + Lager doppelt sind).
14. **Gleichzeitige Buchungen:** zwei Fenster, je ein Warenausgang (Lager Medi-Learn, je Menge 1) möglichst gleichzeitig → beide Zeilen korrekt, zwei Log-Einträge.
15. **Handy-Ansicht (390 px):** Startseite, Bestand, Umlagern, Buchungslog – Screenshots; nichts abgeschnitten, kein horizontales Scrollen.

## Ergebnis
`Phase3_Testprotokoll_v3.md` mit: Ausgangswerte (Schritt 1), Ausführungsprotokolle LAGER_setup / MIG_*, Migrationszahlen, je Testfall Soll / Ist / OK-NOK / Dauer, Fehlermeldungen wörtlich, Zeilennummern, Screenshot-Dateinamen, angeforderte Berechtigungen. Danach STOPP.
