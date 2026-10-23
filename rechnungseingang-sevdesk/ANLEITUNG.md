# Rechnungseingang Gmail → sevDesk: Umbau

Projekt: **„Gmail: Rechnungen -> Sevdesk“** (Apps Script im Konto h.g.w.rieger@gmail.com,
ID `1YZ29h6IWoucoUNwpdvPGrbAPwFPE-2d2GXZkKFnC99gPKxjAiPWNGkCC`).

| Datei | Inhalt |
|---|---|
| `Code.gs` | neuer Code, ersetzt den kompletten Inhalt von `Code.gs` im Projekt |
| `appsscript.json` | Manifest mit dem erweiterten Drive-Dienst (v3) |
| `original/` | Sicherung des bisherigen Codes (Stand 25.08.2026) zum Zurückrollen |
| `test/run-tests.js` | lokaler Test mit nachgebauten Gmail/Drive-Diensten (`node test/run-tests.js`) |

## 1. Analyse des bisherigen Scripts

**Problem 1 ist bestätigt.** Der alte Code holt `sourceLabel.getThreads()`, durchläuft je Thread
**alle** Nachrichten (`thread.getMessages().forEach(...)`) und sendet jede an sevDesk. Es gibt
keine Liste bereits gesendeter Nachrichten. Ob etwas schon verarbeitet ist, erkennt der Code nur am
Label, und Labels gelten in Gmail für den ganzen Thread.

So kam es zum Fall De Witte, im Postfach nachvollzogen:

| Zeitpunkt | Ereignis |
|---|---|
| 16.10. 01:26 | Rechnung INV/26011681 kommt an |
| 18.10. 13:34 | Weiterleitung 1 an sevDesk |
| 19.10. 09:45 | De Witte schickt dieselbe Rechnung erneut, in **denselben Thread** |
| 19.10. 10:34 | Der Thread liegt wieder in „RG: Eingang“, das Script sendet **beide** Nachrichten (Weiterleitung 2 + 3) |

Zusätzlich hat der alte Code beim Archivieren **alle** Benutzer-Labels des Threads entfernt.
Der neue Code entfernt nur „RG: Eingang“ und lässt andere Labels stehen.

**`GmailMessage.forward()` und `from`:** Laut Apps-Script-Dokumentation akzeptiert `forward()` die
Option `from`. Ich bleibe trotzdem bei `GmailApp.sendEmail()` mit `from: 'info@1m4.de'`, aus zwei
Gründen:
- `forward()` hängt die Weiterleitung in den Original-Thread, der damit wieder Labels bekommt.
- `forward()` sendet immer alle Anhänge; bei `sendEmail()` lässt sich das steuern.

Mit `sendEmail()` gehen gezielt die PDF-Anhänge als Blobs mit.

## 2. Wie der neue Ablauf entscheidet

Grundsatz: Verarbeitet wird pro Nachricht (Message-ID), nie pro Thread.

| Fall | Ergebnis |
|---|---|
| Nachricht manuell in „RG: Eingang“ | Absender wird gelernt (außer Ausnahmeadressen). **Senden ohne PDF-Prüfung** (`MANUAL_OVERRIDES_CHECK = false`), auch ohne PDF (`MANUAL_SEND_WITHOUT_PDF = true`) → Archiv |
| Bekannter Absender, PDF enthält „1M4 UG“ oder DE323762513 | senden → Archiv |
| Bekannter Absender, PDF enthält 1M4 OÜ / Järvevana tee 9 / CHREP.me GmbH / EE-USt-ID und **kein** UG-Merkmal | Prüfen |
| Bekannter Absender, nichts eindeutig / PDF nicht lesbar | Prüfen |
| Ausnahmeadresse (Sabina, eigene Adressen, …) mit PDF | Prüfen, wird nie gelernt |
| Unbekannter Absender, PDF + Stichwort (Rechnung, Invoice, …) | Prüfen (`DETECT_UNKNOWN_SENDERS`) |
| PDF mit bereits bekannter Prüfsumme (SHA-256) | Prüfen, Grund „Duplikat“; gilt auch bei manueller Freigabe |
| Message-ID schon gesendet oder beim ersten Lauf im Archiv registriert | wird übersprungen |
| Eigene Weiterleitungen an sevDesk (von info@1m4.de) | werden ignoriert |

Zu den Erkennungsmerkmalen:
- „Strandweg 16, 17213 Göhren-Lebbin“ ist bewusst **kein** UG-Merkmal.
- Die Merkmalsprüfung ist tolerant gegenüber OCR-Fehlern (Leerzeichen, Groß/Klein, „OU“ statt „OÜ“).
- Eine estnische IBAN (EE + 18 Ziffern) gilt nicht als EE-USt-ID.

**Freigabe aus „RG: Prüfen“:** Thread nach „RG: Eingang“ verschieben. Beim nächsten Lauf wird die
Nachricht als manuell freigegeben gesendet, Duplikate ausgenommen.

**Gespeichert in Script Properties** (Projekteinstellungen → Script-Properties):

| Schlüssel | Inhalt |
|---|---|
| `MSG_n` | verarbeitete Message-IDs |
| `SHA_n` | PDF-Prüfsummen |
| `SND_n` | gelernte Absender |
| `INSTALL_TS`, `ARCHIVE_INIT_*` | Installationsdatum und Fortschritt der Erstregistrierung |

- Gesendete IDs und Prüfsummen bleiben 3 Jahre gespeichert (`RETENTION_DAYS`), Archiv-Einträge
  aus dem ersten Lauf dauerhaft.
- Bei aktuell 59 archivierten Nachrichten ist das Limit von 500 KB kein Thema. Ab 400 KB schreibt
  das Script eine Warnung ins Log.
- `showState()` zeigt den gespeicherten Stand. Fehlerhaft gelernte Absender trägst du in
  `SENDERS_TO_REMOVE` ein und führst `removeLearnedSenders()` aus.

## 3. Einrichtung

1. **Code einfügen.** Im Projekt den Inhalt von `Code.gs` vollständig durch die neue `Code.gs`
   ersetzen und speichern.

2. **Drive API aktivieren.**
   - Links bei „Dienste“ auf **+** klicken, **Drive API** wählen, Version **v3**, Kennung `Drive`
     → Hinzufügen.
   - Alternativ: Projekteinstellungen → „Manifestdatei appsscript.json im Editor anzeigen“
     aktivieren und den Inhalt durch `appsscript.json` ersetzen.

3. **Berechtigungen erteilen.** Funktion `processRechnungenEmails` einmal manuell ausführen.
   - Google fragt neue Berechtigungen ab (Drive, Google Docs für die OCR), bitte zulassen.
   - Ohne diesen Schritt schlägt der stündliche Trigger fehl.
   - `DRY_RUN` steht dabei noch auf `true`.

4. **Trigger prüfen.** Links „Trigger“ (Wecker-Symbol) öffnen.
   - Es muss **genau ein** zeitgesteuerter Trigger auf `processRechnungenEmails` existieren,
     stündlich.
   - Fehlt er: `createHourlyTrigger` einmal ausführen.

5. **Erster Lauf (passiert im Schritt 3 automatisch).**
   - Das Installationsdatum wird gesetzt.
   - Alle Nachrichten in „RG: Archiv“ werden als „bereits verarbeitet“ registriert, inklusive
     PDF-Prüfsummen. Das geschieht auch im DRY_RUN, weil es nur bereits gesendete Mails betrifft.
   - Ab dann erkennt das Script automatisch nur Mails ab dem Installationsdatum.

## 4. DRY_RUN-Testlauf

- Im DRY_RUN wird **nichts gesendet**, **kein Label geändert**, kein Absender gelernt und keine
  Message-ID gespeichert.
- Für die PDF-Prüfung wird kurz ein Google Doc angelegt und sofort endgültig gelöscht.
  Liegengebliebene Dateien mit dem Präfix `TMP_RG_OCR_` räumt jeder Lauf auf.
- Als **Vorschau** zeigt die automatische Erkennung im DRY_RUN die letzten 30 Tage
  (`DRY_RUN_AUTO_LOOKBACK_DAYS`), auch Mails vor dem Installationsdatum. Diese Zeilen sind mit
  „[Vorschau: …]“ markiert und werden im Produktivbetrieb **nicht** verarbeitet.
- Das Log findest du unter „Ausführungen“ (jede Zeile: Datum | Absender | Betreff | Ergebnis |
  Grund).

Prüfe im Log mindestens diese Fälle. Lege dafür Testmails nach „RG: Eingang“ bzw. suche passende
der letzten 30 Tage:

| # | Fall | Erwartung im Log |
|---|---|---|
| 1 | UG-Rechnung eines bekannten Lieferanten (z. B. DATEV, 1&1) | `WÜRDE SENDEN … Rechnungsempfänger 1M4 UG (…)` |
| 2 | OÜ-Rechnung (z. B. Ellex Estonia an 1M4 OÜ) | `WÜRDE PRÜFEN … andere Gesellschaft (1M4 OÜ …)` |
| 3 | Weiterleitung von Sabina mit PDF | `WÜRDE PRÜFEN … Ausnahmeadresse`; bei manuellem Verschieben `WÜRDE SENDEN`, aber „wird nicht gelernt“ |
| 4 | Duplikat: dieselbe PDF erneut (z. B. erneute De-Witte-Mail) | `WÜRDE PRÜFEN … Duplikat` |
| 5 | Mail ohne PDF | automatisch: keine Zeile; manuell in Eingang: `WÜRDE SENDEN … kein PDF-Anhang` |
| 6 | Neue Mail in einem alten, archivierten Thread | nur die **neue** Nachricht erscheint im Log, die alten nicht |
| 7 | Rechnung nur mit Privatadresse Strandweg 16 | `WÜRDE PRÜFEN … nicht eindeutig erkennbar` |
| 8 | Neuer Lieferant manuell in Eingang | `Absender würde gelernt: …` |
| 9 | Eigene Weiterleitungen an sevDesk | erscheinen **nicht** im Log |

Im DRY_RUN tauchen dieselben Mails in jedem Lauf wieder auf, das ist normal.

## 5. Umstellen auf Produktivbetrieb

1. In `Code.gs` `var DRY_RUN = false;` setzen und speichern.
2. Optional `processRechnungenEmails` einmal manuell ausführen und das Log prüfen.
3. Danach läuft alles über den stündlichen Trigger.

Zurückrollen: Inhalt aus `original/Code.gs` einfügen. Die Script Properties stören den alten Code
nicht.

## 6. Gmail-Filter, die entfallen können

Diese Filter setzen heute das Label „RG: Eingang“ (gelesen am 23.10.2026):

| Filter (Kriterien) | Absender ist im Startbestand |
|---|---|
| from `info@wir-machen-druck.de`, subject „(Rechnung anbei)“ | ja |
| from `e-invoice@datev.de`, to `info@1m4.de` | ja |
| from `invoice+statements@lovable.dev` | ja |
| from `rechnungsstelle@1und1.de` | ja |
| from `no-reply@smaccounts.eu`, subject „Invoice No.“ | ja |
| from `info@praxisdienst.de`, subject „Ihr Beleg zur Bestellung“ | ja |

**Empfehlung:** erst nach dem DRY_RUN löschen, dann alle sechs.

Warum: Mails, die per Filter in „RG: Eingang“ landen, behandelt das Script wie **manuell
freigegeben**, also ohne PDF-Prüfung. Kommt bei einem dieser Absender eine Rechnung an die OÜ,
ginge sie ungeprüft an sevDesk. Ohne Filter erkennt das Script die Absender automatisch und prüft
den Rechnungsempfänger.

Zu beachten:
- Diese Filter nehmen die Mails heute aus dem Posteingang („Posteingang überspringen“). Ohne Filter
  bleiben die Rechnungen im Posteingang bzw. in den Labels der übrigen Filter, z. B. dem Filter für
  `to:info@1m4.de`.
- Das Script verschiebt Mails nicht aus dem Posteingang. Es setzt nur „RG: Archiv“ oder
  „RG: Prüfen“.

## 7. Hinweise und Grenzen

- **Gmail-Filter gelten als Freigabe.** Mails, die ein Filter nach „RG: Eingang“ legt, gelten als
  manuell freigegeben. Wer das nicht will, setzt `MANUAL_OVERRIDES_CHECK = true`; dann wird auch
  im Eingang die PDF-Prüfung gemacht.
- **Nur PDFs an sevDesk.** Gesendet werden nur PDF-Anhänge (`SEND_ONLY_PDF_ATTACHMENTS = true`).
  Sollen auch XRechnung-XML-Dateien mit, auf `false` setzen.
- **Unlesbare PDFs.** OCR ist auf Drive-Seite begrenzt (Dateigröße, Seitenzahl). Sehr große oder
  geschützte PDFs landen als „PDF nicht lesbar“ in „Prüfen“.
- **Prüfsummen-Duplikate.** Der Duplikatschutz greift nur bei byte-identischen PDFs. Erzeugt ein
  Lieferant dieselbe Rechnung neu (anderes PDF), schützt die Prüfsumme nicht. Dann bleibt der
  Schutz über die Message-ID.
- **Thread mit Archiv- und Eingang-Label beim ersten Lauf.** Hat ein Thread beim ersten Lauf
  beide Labels, wird dessen neueste Nachricht nicht als verarbeitet registriert (Hinweis im Log).
  Aktuell ist „RG: Eingang“ leer, der Fall tritt also nicht auf.
