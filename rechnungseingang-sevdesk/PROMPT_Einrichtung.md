# Aufgabe: Neues Rechnungs-Script im Google Apps Script einrichten (nur DRY_RUN)

Du arbeitest im Browser (Chrome) mit meinem Google-Konto **h.g.w.rieger@gmail.com**. Prüfe vor
jedem Schritt, dass oben rechts genau dieses Konto aktiv ist. Ist ein anderes Konto aktiv, wechsle
das Konto oder brich ab und frag mich.

## Ziel

Im bestehenden Apps-Script-Projekt **„Gmail: Rechnungen -> Sevdesk“** den Code durch die neue
Version ersetzen, die Drive API aktivieren und einen ersten Testlauf im **DRY_RUN** ausführen.
Danach berichtest du mir das Ergebnis. **Nicht** auf Produktivbetrieb umstellen.

- Projekt: https://script.google.com/home/projects/1YZ29h6IWoucoUNwpdvPGrbAPwFPE-2d2GXZkKFnC99gPKxjAiPWNGkCC/edit
- Neuer Code: GitHub-Repo `1m4ecom-eng/text`, Branch `claude/fervent-pasteur-y169de`, Datei
  `rechnungseingang-sevdesk/Code.gs`.
  - Raw-Ansicht: https://github.com/1m4ecom-eng/text/raw/claude/fervent-pasteur-y169de/rechnungseingang-sevdesk/Code.gs
  - Falls GitHub nicht erreichbar ist: frag mich nach der Datei, rate nichts.

## Harte Regeln

- `DRY_RUN` bleibt **`true`**. Ändere diese Zeile nicht.
- Lösche oder ändere **keine** Gmail-Filter, Labels, Mails oder Drive-Dateien.
- Sende keine E-Mails.
- Ändere im Code **nichts**: kein Umformatieren, keine Korrekturen. Er wird 1:1 eingefügt.
- Lösche keine Trigger außer über die Funktion `createHourlyTrigger` (Schritt 6).
- Erscheint ein Dialog, den du nicht eindeutig zuordnen kannst: stoppen und mich fragen.
- Dazu gehören z. B. Zahlungen, Freigaben für andere Konten oder Bereitstellungen
  (Deploy / Web-App / API).

## Schritte

### 1. Code kopieren
- Öffne die Raw-Ansicht der neuen `Code.gs` in einem neuen Tab.
- Klicke in den Text, dann Strg+A und Strg+C.
- Prüfe vorher, dass die Datei mit `/**` und
  `* Google Apps Script: Rechnungseingang Gmail -> sevDesk` beginnt und mit der Funktion
  `listLabels()` endet.

### 2. Code einfügen
- Öffne das Projekt und links die Datei **Code.gs**.
- Klicke in den Editor, dann Strg+A, Entf und Strg+V. Nicht tippen, sondern einfügen; sonst setzt
  der Editor automatisch Klammern und Einrückungen.
- Speichern mit Strg+S.
- Kontrolle:
  - Oben steht `var DRY_RUN = true;`.
  - Unten endet die Datei mit `listLabels()`.
  - Es gibt keine roten Fehlermarkierungen.
  - Es gibt keine weitere `.gs`-Datei, die ebenfalls `processRechnungenEmails` definiert.
    Falls doch: stoppen und mich fragen.

### 3. Drive API hinzufügen
- Links bei **„Dienste“** auf **+** klicken.
- **Drive API** wählen, Version **v3**, Kennung **`Drive`**, dann **Hinzufügen**.
- Ist „Drive“ schon in der Liste: Version prüfen und nichts weiter tun.

### 4. Erster Lauf mit Berechtigungen
- Im Funktions-Dropdown oben **`processRechnungenEmails`** wählen und auf **Ausführen** klicken.
- Google zeigt den Dialog „Autorisierung erforderlich“:
  - Konto h.g.w.rieger@gmail.com wählen.
  - Bei „Google hat diese App nicht überprüft“: **Erweitert** → **Zu „Gmail: Rechnungen -> Sevdesk“
    wechseln (unsicher)**. Das ist hier korrekt, es ist mein eigenes Script.
  - **Zulassen**.
- Warte, bis die Ausführung fertig ist (bis ca. 6 Minuten).
- Steht im Log „Erstregistrierung … wird im nächsten Lauf fortgesetzt“: einmal erneut ausführen.

### 5. Log sichern
- Kopiere das komplette Ausführungsprotokoll unten im Editor.
- Falls es abgeschnitten ist: links **„Ausführungen“** öffnen, den letzten Lauf anklicken und von
  dort kopieren.

### 6. Trigger prüfen
- Links das Wecker-Symbol **„Trigger“** öffnen.
- Es muss **genau ein** Trigger mit Funktion `processRechnungenEmails`, zeitgesteuert, stündlich
  existieren.
- Gibt es keinen oder mehrere: im Editor die Funktion **`createHourlyTrigger`** wählen und
  **Ausführen**. Danach die Trigger-Liste erneut prüfen.

### 7. Zustand prüfen
- Funktion **`showState`** ausführen und die Ausgabe kopieren.
- Erwartung:
  - „DRY_RUN: true“
  - ein Installationsdatum ist gesetzt
  - „Erstregistrierung Archiv abgeschlossen: ja“
  - rund 59 Message-IDs „aus Archiv“
  - 0 gesendet

## Bericht an mich

Gib mir am Ende:

1. **Status je Schritt (1–7):** erledigt / Problem, mit Fehlermeldung im Wortlaut.
2. **Ausgabe von `showState`.**
3. **Auswertung des DRY_RUN-Logs.**
   - Tabelle aller Zeilen mit „WÜRDE SENDEN“ oder „WÜRDE PRÜFEN“: Datum, Absender, Betreff,
     Ergebnis, Grund.
   - Markiere Zeilen mit „[Vorschau …]“.
4. **Auffälligkeiten.** Ordne die Log-Zeilen zuerst diesen Fällen zu (falls vorhanden) und sag mir,
   ob das Ergebnis plausibel aussieht:
   - UG-Rechnung → senden
   - OÜ-Rechnung → prüfen
   - Mail von sabina.rieger73@gmail.com → prüfen
   - „Duplikat“
   - „PDF nicht lesbar“
   - neue Mail in altem Thread

   Melde außerdem:
   - Zeilen mit „Fehler“, „WARNUNG“ oder „ABBRUCH“
   - jede UG-Rechnung, die als „PRÜFEN“ eingestuft wurde
   - jede Nicht-UG-Rechnung, die als „SENDEN“ eingestuft wurde
5. **Bestätigung:** `DRY_RUN` steht weiterhin auf `true`, und es wurden keine Filter, Labels oder
   Mails geändert.

Die Umstellung auf `DRY_RUN = false` und das Löschen der alten Gmail-Filter mache ich selbst, oder
ich gebe dir dafür später einen eigenen Auftrag.
