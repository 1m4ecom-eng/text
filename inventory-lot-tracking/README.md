# 1M4 Inventory – LOT-Tracking

Erweiterung der Google-Sheets-Warenverwaltung „1M4 Inventory“ (Sheetify-Vorlage) um LOT-Rückverfolgung.
Umgesetzt und getestet in der Kopie **„1M4 Inventory – LOT TEST“** (gleicher Drive-Ordner wie das Original).

## Was sich ändert

| Tab | Änderung |
|---|---|
| **LOTs** (neu) | LOT-Register und LOT-Übersicht: Eingangsdatum, Item, SKU (auto), LOT, Verfallsdatum, Menge Eingang, Quelle, Sperre (Frei/Gesperrt). Berechnet: Ausgang Verkauf, Korrektur, Restbestand, Status, „➡️ Nächste“. Warnfrist vor Ablauf in `M3` (Standard 90 Tage). |
| **Sales** | Neue Spalte **N „LOT“**. Wird beim Status „🚚 Shipped“ automatisch befüllt und bleibt dann fest, z. B. `L-001 (3); L-002 (2)`. |
| **Correction** | Neue Spalte **N „LOT“** (Dropdown). Korrekturen werden damit der jeweiligen LOT zugerechnet. |
| **Inventory** | Der Bestand pro SKU (Spalte K) bleibt unverändert und zeigt weiterhin den Gesamtbestand. Neu: **W „Nächste LOT“** und **X „Ohne LOT“**, d. h. SKU-Bestand minus Summe der LOT-Restbestände. |

## Regeln

- **Reihenfolge:** Zuerst kommt die LOT mit dem kürzesten Verfallsdatum (FEFO). LOTs ohne Verfallsdatum folgen danach, sortiert nach Eingangsdatum (FIFO).
- **Übersprungen** werden LOTs, die gesperrt oder abgelaufen sind (Stichtag: Order Date des Verkaufs, sonst heute) oder deren Restbestand 0 ist.
- **Artikel ohne LOT-Pflicht:** Gibt es für einen Artikel keine Zeile im Tab LOTs, passiert nichts. Inventory W und X zeigen dann „–“.
- **Zu wenig LOT-Bestand:** Der Rest wird als `OHNE LOT (n)` gebucht und rot markiert. Sobald die LOT erfasst ist: Menü **🏷️ LOT → Offene Zuordnungen nachholen**.
- **Retoure:** Setzt man den Status von „Shipped“ auf „Returned to Inventory“, geht die Menge automatisch zurück auf die ursprüngliche LOT. Der LOT-Text bleibt als Historie stehen.
- **Menge oder Item geändert** bei einer versendeten Zeile: Die Zeile wird automatisch neu zugeordnet.
- **Dieselbe LOT ein zweites Mal geliefert:** Die Menge in der bestehenden LOT-Zeile erhöhen, keine zweite Zeile anlegen. Doppelte LOTs werden rot markiert.
- **Wareneingang:** Wird in Purchases der Status auf „✅ Received“ gesetzt, fragt das Sheet, ob eine vorbefüllte LOT-Zeile angelegt werden soll. Danach nur noch LOT und Verfallsdatum eintragen. Bei mehreren LOTs die Zeile kopieren und die Mengen aufteilen.

## Einrichtung (einmalig, in der Testkopie)

1. Die Testkopie öffnen und **Erweiterungen → Apps Script** wählen.
2. Links auf **＋ → Skript** klicken und die Datei `LotTracking` nennen.
3. Den Inhalt von [`LotTracking.gs`](LotTracking.gs) vollständig einfügen und speichern. Die bestehenden Sheetify-Dateien bleiben unverändert.
4. Oben in der Funktionsauswahl **`LOT_install`** wählen, auf **Ausführen** klicken und die Berechtigungen bestätigen.
5. Zurück im Sheet erscheint das Menü **🏷️ LOT**.

## Menü 🏷️ LOT

- **LOT für markierte Verkaufszeilen neu zuordnen**: Ordnet die markierten Sales-Zeilen komplett neu zu, etwa nach einer Korrektur.
- **Offene Zuordnungen nachholen**: Bearbeitet alle versendeten Zeilen, deren LOT leer ist oder „OHNE LOT“ enthält. Ältere Aufträge kommen zuerst dran.
- **Prüfung: SKU-Bestand vs. LOT-Bestand**: Listet Abweichungen, doppelte LOTs und negative Restbestände auf.

## Bestandsdaten übernehmen

Für Ware, die bereits auf Lager ist (z. B. Keyboard Cover 95, Privatrezepte blau 495), legst du pro LOT eine Zeile im Tab LOTs an. Als **Eingangsdatum** das tatsächliche Eingangsdatum eintragen, als **Menge Eingang** den aktuellen Bestand dieser LOT und als Quelle „Anfangsbestand“.
Die Spalte „Ohne LOT“ in Inventory muss danach bei 0 stehen.

## Hinweise

- Die Formeln im Tab LOTs reichen bis Zeile 1000. Für mehr LOTs die Zeilen samt Formeln nach unten kopieren.
- Ein Verkauf mit Status „Shipped“, der vor der Einrichtung bereits existierte, bleibt ohne LOT, bis „Offene Zuordnungen nachholen“ ausgeführt wird.
- `LotTracking.gs` enthält keine Funktionen `onOpen` oder `onEdit`. Alle Funktionen tragen das Präfix `LOT_`, deshalb gibt es keine Konflikte mit dem Sheetify-Script.
