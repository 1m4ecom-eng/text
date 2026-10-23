/**
 * Google Apps Script: Rechnungs-Emails automatisch an Sevdesk weiterleiten & archivieren
 * ----------------------------------------------------------------------------------------
 * Was das Skript macht (stündlich, automatisch, rund um die Uhr):
 * 1. Sucht alle E-Mails im Gmail-Ordner (Label) "Buisness/[99] Buha/[01] RG: Eingang"
 *    (Die Zuordnung "welche Mail landet dort" übernimmt eine separate
 *    Gmail-Regel/Filter, die im Gmail-Konto selbst angelegt wird.)
 * 2. Leitet jede E-Mail (inkl. Anhänge) an autobox@sevdesk.email weiter
 * 3. Entfernt ALLE bestehenden Labels des Threads (nicht nur das Eingang-Label)
 *    und setzt danach ausschließlich das Label "Buisness/[99] Buha/[02] RG: Archiv"
 *    (Systemstatus wie Posteingang/Gelesen sind davon nicht betroffen, das
 *    sind keine "Labels" im Gmail-API-Sinn, siehe Hinweis unten)
 * 4. Markiert die E-Mail als gelesen
 *
 * Installation:
 * 1. Auf https://script.google.com ein neues Projekt anlegen
 * 2. Diesen Code einfügen und speichern
 * 3. In Gmail eine Regel/Filter anlegen, die passende Rechnungs-Mails automatisch
 *    mit dem Label "Buisness/[99] Buha/[01] RG: Eingang" versieht (siehe Hinweis
 *    unten). Das Label muss dafür vorher in Gmail existieren.
 * 4. Einmalig die Funktion "createHourlyTrigger" ausführen (oben im Dropdown
 *    auswählen -> Run) -> Google fragt nach Berechtigungen für Gmail; bitte zulassen
 * 5. Ab dann läuft "processRechnungenEmails" automatisch einmal pro Stunde,
 *    rund um die Uhr (24 Ausführungen/Tag, jeweils ca. zur vollen Stunde ab
 *    dem Erstellungszeitpunkt des Triggers).
 *
 * Hinweis zur Gmail-Regel (Filter):
 * Gmail -> Einstellungen -> Filter und blockierte Adressen -> "Neuen Filter
 * erstellen" -> Suchkriterien eingeben (z. B. Absenderadresse(n) und/oder
 * Betreff-Stichwörter wie "Rechnung"/"Invoice") -> "Filter erstellen" ->
 * Haken bei "Label anwenden" setzen und "[99] Buha/[01] RG: Eingang" auswählen.
 * Der Name des Labels muss exakt mit SOURCE_LABEL_NAME unten übereinstimmen
 * (Groß-/Kleinschreibung, Leerzeichen, "/" für verschachtelte Labels, inkl.
 * des Doppelpunkts nach "RG").
 *
 * Hinweis zu den Ordnernamen: Falls dein Ordner/Label anders geschrieben ist,
 * bitte SOURCE_LABEL_NAME unten anpassen. Mit der Funktion "listLabels"
 * (ganz unten) kannst du dir alle vorhandenen Labels exakt auflisten lassen.
 */
 
var SOURCE_LABEL_NAME = 'Buisness/[99] Buha/[01] RG: Eingang';
var TARGET_LABEL_NAME = 'Buisness/[99] Buha/[02] RG: Archiv';
var FORWARD_TO = 'autobox@sevdesk.email';
var FORWARD_FROM = 'info@1m4.de';
 
function processRechnungenEmails() {
  var sourceLabel = GmailApp.getUserLabelByName(SOURCE_LABEL_NAME);
  if (!sourceLabel) {
    Logger.log('Label "' + SOURCE_LABEL_NAME + '" wurde nicht gefunden. Bitte Namen prüfen.');
    return;
  }
 
  var targetLabel = GmailApp.getUserLabelByName(TARGET_LABEL_NAME);
  if (!targetLabel) {
    targetLabel = GmailApp.createLabel(TARGET_LABEL_NAME);
  }
 
  var threads = sourceLabel.getThreads();
  Logger.log(threads.length + ' Thread(s) im Ordner "' + SOURCE_LABEL_NAME + '" gefunden.');
 
  var processedCount = 0;
 
  threads.forEach(function (thread) {
    try {
      var messages = thread.getMessages();
 
      messages.forEach(function (message) {
        // Wichtig: Wir nutzen GmailApp.sendEmail() statt message.forward().
        // message.forward() haengt die weitergeleitete Mail in denselben
        // Thread wie die Original-Mail - dadurch wuerde die eigene
        // "Gesendet"-Kopie automatisch das Label "RG verarbeitet" mit
        // abbekommen (Labels gelten pro Thread, nicht pro Einzelmail).
        // sendEmail() erzeugt stattdessen eine unabhaengige neue Mail in
        // einem eigenen Thread, der nicht gelabelt wird.
        //
        // "from" setzt den Absender auf info@1m4.de - dafuer muss diese
        // Adresse im Gmail-Konto unter Einstellungen > Konten > "Mail
        // senden als" hinterlegt sein, sonst schlaegt der Versand fehl.
        var subject = message.getSubject();
        if (!/^(Fwd|FW|WG):/i.test(subject)) {
          subject = 'Fwd: ' + subject;
        }
 
        var forwardHeaderPlain =
          '---------- Weitergeleitete Nachricht ----------\n' +
          'Von: ' + message.getFrom() + '\n' +
          'Datum: ' + message.getDate() + '\n' +
          'Betreff: ' + message.getSubject() + '\n' +
          'An: ' + message.getTo() + '\n\n';
 
        var forwardHeaderHtml =
          '<p>---------- Weitergeleitete Nachricht ----------<br>' +
          'Von: ' + message.getFrom() + '<br>' +
          'Datum: ' + message.getDate() + '<br>' +
          'Betreff: ' + message.getSubject() + '<br>' +
          'An: ' + message.getTo() + '</p><br>';
 
        GmailApp.sendEmail(
          FORWARD_TO,
          subject,
          forwardHeaderPlain + message.getPlainBody(),
          {
            from: FORWARD_FROM,
            htmlBody: forwardHeaderHtml + message.getBody(),
            attachments: message.getAttachments({
              includeInlineImages: false,
              includeAttachments: true
            })
          }
        );
      });
 
      // Alle vorhandenen (Benutzer-)Labels des Threads entfernen - nicht nur
      // das Eingang-Label, sondern wirklich jedes Label, das aktuell am
      // Thread haengt. Danach bleibt ausschliesslich das Archiv-Label uebrig.
      // Hinweis: getLabels()/removeLabel() betreffen nur benutzerdefinierte
      // Labels. Systemstatus wie "Posteingang", "Gelesen/Ungelesen" oder
      // "Wichtig" sind separate Flags und werden davon nicht beruehrt.
      var existingLabels = thread.getLabels();
      existingLabels.forEach(function (label) {
        thread.removeLabel(label);
      });
 
      thread.addLabel(targetLabel);
      thread.markRead();
 
      processedCount++;
    } catch (err) {
      Logger.log(
        'FEHLER bei Thread "' + thread.getFirstMessageSubject() + '" ' +
        '(Thread wurde NICHT verschoben/als gelesen markiert): ' + err.message
      );
    }
  });
 
  Logger.log(processedCount + ' von ' + threads.length + ' Thread(s) weitergeleitet und verschoben.');
}
 
/**
 * Einmalig ausführen: Legt den stündlichen Trigger an (löscht zuvor evtl.
 * vorhandene Trigger für diese Funktion, damit sie nicht doppelt läuft).
 * Läuft rund um die Uhr, ca. alle 60 Minuten ab dem Zeitpunkt der Erstellung.
 */
function createHourlyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processRechnungenEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
 
  ScriptApp.newTrigger('processRechnungenEmails')
    .timeBased()
    .everyHours(1)
    .create();
 
  Logger.log('Stündlicher Trigger für "processRechnungenEmails" wurde erstellt (rund um die Uhr, ca. alle 60 Minuten).');
}
 
/**
 * Hilfsfunktion zum Debuggen: Listet alle vorhandenen Gmail-Labels
 * exakt so auf, wie Google sie speichert (inkl. Groß-/Kleinschreibung
 * und verschachtelter Ordner mit "/"). Einmal ausführen und im
 * Execution log (Protokoll) nachsehen.
 */
function listLabels() {
  var labels = GmailApp.getUserLabels();
  labels.forEach(function (label) {
    Logger.log('"' + label.getName() + '"');
  });
}