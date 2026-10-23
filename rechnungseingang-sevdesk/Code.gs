/**
 * Google Apps Script: Rechnungseingang Gmail -> sevDesk (lernend, inhaltsbasiert)
 * ----------------------------------------------------------------------------------------
 * Läuft stündlich (Zeit-Trigger auf "processRechnungenEmails") im Konto h.g.w.rieger@gmail.com.
 *
 * Ablauf pro Lauf:
 *  0. Erster Lauf: Alle Nachrichten in "RG: Archiv" werden als "bereits verarbeitet"
 *     registriert (inkl. PDF-Prüfsummen) und das Installationsdatum wird gespeichert.
 *  1. Manueller Eingang ("RG: Eingang"): Jede noch nicht gesendete Nachricht wird einzeln
 *     verarbeitet. Der Absender wird gelernt (außer Ausnahmeadressen). Standard: Senden ohne
 *     PDF-Prüfung (MANUAL_OVERRIDES_CHECK = false), Duplikate werden aber nie gesendet.
 *  2. Automatische Erkennung: Neue Nachrichten (ab Installationsdatum) mit PDF-Anhang
 *     - von bekannten Absendern -> PDF-Prüfung (OCR) -> senden oder "RG: Prüfen"
 *     - von Ausnahmeadressen -> immer "RG: Prüfen"
 *     - von unbekannten Absendern mit Rechnungs-Stichwort -> "RG: Prüfen" (DETECT_UNKNOWN_SENDERS)
 *
 * Verarbeitung immer pro Nachricht (Message-ID), nie pro Thread. Gesendete Message-IDs und
 * PDF-Prüfsummen (SHA-256) liegen in den Script Properties; nichts wird doppelt gesendet.
 *
 * Voraussetzung: Erweiterter Dienst "Drive API" (v3) ist aktiviert (siehe appsscript.json).
 */

// =====================================================================================
// KONFIGURATION
// =====================================================================================

// true = nichts senden, keine Labels ändern, nichts lernen; nur loggen, was passieren würde.
var DRY_RUN = true;

// false = manuell nach "RG: Eingang" verschobene Mails werden ohne PDF-Prüfung gesendet.
// true  = auch manuell verschobene Mails durchlaufen die PDF-Prüfung.
var MANUAL_OVERRIDES_CHECK = false;

// Manuell verschobene Mails ohne PDF-Anhang trotzdem senden (nur wenn MANUAL_OVERRIDES_CHECK = false).
var MANUAL_SEND_WITHOUT_PDF = true;

// Unbekannte Absender mit PDF + Rechnungs-Stichwort nach "RG: Prüfen" legen.
var DETECT_UNKNOWN_SENDERS = true;

// false = PDF-Mails von Ausnahmeadressen landen immer in "RG: Prüfen".
// true  = nur, wenn Betreff/Dateiname nach Rechnung aussieht.
var EXCLUDED_REQUIRE_INVOICE_KEYWORDS = false;

// true = nur PDF-Anhänge an sevDesk senden; false = alle Anhänge (z. B. auch XRechnung-XML).
var SEND_ONLY_PDF_ATTACHMENTS = true;

// Laufzeit: pro Lauf höchstens so viele Nachrichten bearbeiten (Rest im nächsten Lauf).
var MAX_MESSAGES_PER_RUN = 15;
var MAX_RUNTIME_MS = 4.5 * 60 * 1000; // Apps-Script-Limit ist 6 Minuten

// Automatische Erkennung: so viele Tage zurück suchen (zusätzlich nie vor Installationsdatum).
var AUTO_SEARCH_WINDOW_DAYS = 14;
var AUTO_SEARCH_MAX_THREADS = 100;
// Nur im DRY_RUN: Vorschau der automatischen Erkennung über die letzten N Tage,
// auch vor dem Installationsdatum (im Produktivbetrieb werden diese ignoriert).
var DRY_RUN_AUTO_LOOKBACK_DAYS = 30;

// Wie lange gesendete Message-IDs und Prüfsummen aufbewahrt werden (Tage).
// Registrierungen aus dem Archiv beim ersten Lauf werden nie gelöscht.
var RETENTION_DAYS = 1095;

// Labels (exakte Schreibweise inkl. "Buisness")
var LABEL_INBOX = 'Buisness/[99] Buha/[01] RG: Eingang';
var LABEL_ARCHIVE = 'Buisness/[99] Buha/[02] RG: Archiv';
var LABEL_REVIEW = 'Buisness/[99] Buha/[03] RG: Prüfen';

// Versand
var FORWARD_TO = 'autobox@sevdesk.email';
var FORWARD_FROM = 'info@1m4.de'; // Send-as-Alias; sevDesk akzeptiert nur diesen Absender

// Rechnungsempfänger 1M4 UG: Firmenname (Groß/Klein egal, OCR-tolerant) oder USt-IdNr.
// Achtung: "Strandweg 16, 17213 Göhren-Lebbin" ist auch Privatadresse -> bewusst KEIN Merkmal.
var UG_NAME_PATTERNS = [
  /[1il|]\s*m\s*4\s*ug\b/i // "1M4 UG", "1M4 UG (haftungsbeschränkt)"
];
var UG_VAT_IDS = ['DE323762513']; // wird ohne Leerzeichen/Satzzeichen verglichen

// Merkmale anderer Gesellschaften (führen nur ohne UG-Merkmal zu "Prüfen")
var OTHER_COMPANY_PATTERNS = [
  { name: '1M4 OÜ', re: /[1il|]\s*m\s*4\s*[o0][üu](?![a-z0-9])/i },
  { name: 'Järvevana tee 9', re: /j[äa]rvevana\s*tee\s*9\b/i },
  { name: 'CHREP.me GmbH', re: /chrep\s*\.?\s*me\s*gmbh/i },
  { name: 'estnische USt-ID (EE…)', re: /\bEE\s?\d{9}(?!\d)/ }
];

// Betreff/Dateiname sieht nach Rechnung aus
var INVOICE_KEYWORDS = /rechnung|invoice|beleg|receipt|gutschrift|credit\s*-?\s*note|factuur|\barve|gebührenbescheid/i;

// Adressen, über die weitergeleitete Rechnungen aller Art kommen: nie lernen, immer prüfen.
var EXCLUDED_SENDERS = [
  'sabina.rieger73@gmail.com',
  'info@chrep.me',
  'h.g.w.rieger@gmail.com',
  'rieger_helmut@gmx.de',
  'hr@1m4.eu',
  'info@1m4.de',
  'info@1m4.eu',
  'info@1m4.ee',
  'info@degrof.com'
];

// Startbestand der Absenderliste (exakte Adressen). Gelernte Absender kommen in den Script Properties dazu.
var INITIAL_SENDERS = [
  'info@wir-machen-druck.de',
  'e-invoice@datev.de',
  'info@praxisdienst.de',
  'caroline@dewitte.com',
  'accounting.estonia@ellex.legal',
  'invoice+statements@mail.anthropic.com',
  'no-reply@smaccounts.eu',
  'sales@thesolutionshop.nl',
  'claudia.lehmann@olw.de',
  'ear-portal@stiftung-ear.de',
  'no-reply@breuninger.com',
  'invoice+statements@bitwarden.com',
  'import@transmaritim.com',
  'rechnungsstelle@1und1.de',
  'invoice+statements@lovable.dev',
  'kristina.hanscomb@ecovis-rts.de'
];

// Für die Pflegefunktion removeLearnedSenders(): diese Adressen aus der gelernten Liste entfernen.
var SENDERS_TO_REMOVE = [];

// OCR
var OCR_LANGUAGE = 'de';
var TEMP_FILE_PREFIX = 'TMP_RG_OCR_';
var MIN_TEXT_LENGTH = 20;

// Script-Properties-Schlüssel (nicht ändern)
var PROP_INSTALL_TS = 'INSTALL_TS';
var PROP_INIT_DONE = 'ARCHIVE_INIT_DONE';
var PROP_INIT_CURSOR = 'ARCHIVE_INIT_CURSOR';
var SHARD_MSG = 'MSG_';
var SHARD_SHA = 'SHA_';
var SHARD_SENDERS = 'SND_';
var SHARD_MAX_CHARS = 8000; // Limit pro Property-Wert: 9 KB

// =====================================================================================
// HAUPTFUNKTION (Trigger)
// =====================================================================================

function processRechnungenEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Ein anderer Lauf ist noch aktiv, dieser Lauf wird übersprungen.');
    return;
  }
  try {
    run_();
  } finally {
    lock.releaseLock();
  }
}

function run_() {
  var ctx = {
    start: Date.now(),
    actions: 0,
    store: Store_.load(),
    own: ownAddresses_(),
    tz: Session.getScriptTimeZone(),
    stats: { sent: 0, review: 0, errors: 0 }
  };
  Logger.log('=== Lauf gestartet' + (DRY_RUN ? ' (DRY_RUN: es wird nichts gesendet und kein Label geändert)' : '') + ' ===');

  if (!ctx.own[FORWARD_FROM.toLowerCase()]) {
    Logger.log('ABBRUCH: "' + FORWARD_FROM + '" ist kein Send-as-Alias dieses Kontos (Gmail > Einstellungen > Konten > "Senden als").');
    return;
  }

  cleanupTempFiles_();

  if (!initArchive_(ctx)) {
    Logger.log('Erstregistrierung des Archivs noch nicht abgeschlossen, wird im nächsten Lauf fortgesetzt.');
    return;
  }

  processInboxLabel_(ctx);
  processAutoDetection_(ctx);

  ctx.store.prune();
  ctx.store.save();

  Logger.log('=== Lauf beendet: ' + ctx.stats.sent + ' gesendet, ' + ctx.stats.review + ' nach "Prüfen", ' +
    ctx.stats.errors + ' Fehler, ' + ctx.actions + ' Nachricht(en) bearbeitet ===');
}

// =====================================================================================
// ERSTER LAUF: ARCHIV REGISTRIEREN
// =====================================================================================

function initArchive_(ctx) {
  var store = ctx.store;
  if (store.getProp(PROP_INIT_DONE)) return true;

  if (!store.getProp(PROP_INSTALL_TS)) {
    store.setProp(PROP_INSTALL_TS, String(Date.now()));
    Logger.log('Installationsdatum gesetzt: ' + formatDate_(new Date(), ctx.tz));
  }

  var label = GmailApp.getUserLabelByName(LABEL_ARCHIVE);
  if (label) {
    var cursor = Number(store.getProp(PROP_INIT_CURSOR) || 0);
    var registered = 0;
    while (true) {
      var threads = label.getThreads(cursor, 50);
      if (!threads.length) break;
      for (var i = 0; i < threads.length; i++) {
        if (timeUp_(ctx)) {
          store.save(true);
          store.setProp(PROP_INIT_CURSOR, String(cursor));
          return false;
        }
        registered += registerArchivedThread_(ctx, threads[i]);
      }
      cursor += threads.length;
      store.save(true); // Registrierung wird auch im DRY_RUN gespeichert (betrifft nur bereits archivierte Mails)
      store.setProp(PROP_INIT_CURSOR, String(cursor));
    }
    Logger.log('Erstregistrierung: ' + registered + ' Nachricht(en) aus "' + LABEL_ARCHIVE + '" als bereits verarbeitet gespeichert.');
  }
  store.setProp(PROP_INIT_DONE, String(Date.now()));
  return true;
}

function registerArchivedThread_(ctx, thread) {
  var messages = thread.getMessages();
  var count = messages.length;
  // Thread mit Archiv- UND Eingang-Label: die neueste Nachricht ist vermutlich noch nicht gesendet.
  if (threadHasLabel_(thread, LABEL_INBOX)) {
    count = messages.length - 1;
    Logger.log('Hinweis Erstregistrierung: Thread "' + thread.getFirstMessageSubject() +
      '" liegt in Archiv UND Eingang; die neueste Nachricht wird nicht als verarbeitet registriert. Bitte im Log prüfen.');
  }
  var n = 0;
  for (var i = 0; i < count; i++) {
    var m = messages[i];
    if (!ctx.store.getMsgStatus(m.getId())) {
      ctx.store.setMsg(m.getId(), 'a');
      n++;
    }
    pdfAttachments_(m).forEach(function (pdf) {
      ctx.store.addHash(sha256_(pdf), true);
    });
  }
  return n;
}

// =====================================================================================
// 1. MANUELLER EINGANG
// =====================================================================================

function processInboxLabel_(ctx) {
  var label = GmailApp.getUserLabelByName(LABEL_INBOX);
  if (!label) {
    Logger.log('Label "' + LABEL_INBOX + '" nicht gefunden.');
    return;
  }
  var threads = label.getThreads(0, 50);
  for (var t = 0; t < threads.length; t++) {
    if (limitReached_(ctx)) {
      Logger.log('Limit erreicht, restliche Threads in "RG: Eingang" folgen im nächsten Lauf.');
      return;
    }
    var thread = threads[t];
    var outcome = { sent: 0, review: 0, already: 0, complete: true };
    var messages = thread.getMessages();
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var status = ctx.store.getMsgStatus(m.getId());
      if (status === 's' || status === 'a') {
        outcome.already++;
        continue;
      }
      try {
        if (m.isInTrash() || isOwnOutgoing_(m, ctx)) continue;
      } catch (e) {
        markError_(ctx, m, e);
        outcome.review++;
        continue;
      }
      if (limitReached_(ctx)) {
        outcome.complete = false;
        break;
      }
      ctx.actions++;
      if (handleMessage_(ctx, m, 'manual')) outcome.sent++;
      else outcome.review++;
    }
    if (!outcome.complete) {
      Logger.log('Limit erreicht, Thread "' + thread.getFirstMessageSubject() + '" wird im nächsten Lauf fortgesetzt.');
      return;
    }
    finalizeInboxThread_(ctx, thread, outcome);
  }
}

function finalizeInboxThread_(ctx, thread, outcome) {
  var subject = thread.getFirstMessageSubject();
  var target;
  if (outcome.review) target = 'Prüfen' + (outcome.sent ? ' + Archiv' : '');
  else if (outcome.sent || outcome.already) target = 'Archiv';
  else target = 'Prüfen (keine verarbeitbare Nachricht im Thread)';

  if (DRY_RUN) {
    Logger.log('[DRY_RUN] Thread "' + subject + '": würde Label "RG: Eingang" entfernen -> ' + target);
    return;
  }
  try {
    thread.removeLabel(GmailApp.getUserLabelByName(LABEL_INBOX));
    if (outcome.review || (!outcome.sent && !outcome.already)) {
      thread.addLabel(getOrCreateLabel_(LABEL_REVIEW));
    }
    if (outcome.sent || outcome.already) {
      thread.addLabel(getOrCreateLabel_(LABEL_ARCHIVE));
    }
    if (!outcome.review && (outcome.sent || outcome.already)) {
      var review = GmailApp.getUserLabelByName(LABEL_REVIEW);
      if (review) thread.removeLabel(review);
      thread.markRead();
    }
  } catch (e) {
    Logger.log('FEHLER beim Setzen der Labels für Thread "' + subject + '": ' + e.message);
  }
}

// =====================================================================================
// 2. AUTOMATISCHE ERKENNUNG
// =====================================================================================

function processAutoDetection_(ctx) {
  var now = Date.now();
  var installTs = Number(ctx.store.getProp(PROP_INSTALL_TS));
  var since = Math.max(installTs, now - AUTO_SEARCH_WINDOW_DAYS * 86400000);
  if (DRY_RUN) since = Math.min(since, now - DRY_RUN_AUTO_LOOKBACK_DAYS * 86400000);

  var query = 'has:attachment filename:pdf -in:spam -in:trash -in:drafts after:' + Math.floor(since / 1000);
  var threads = GmailApp.search(query, 0, AUTO_SEARCH_MAX_THREADS);
  var known = ctx.store.knownSenders();

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    if (threadHasLabel_(thread, LABEL_INBOX)) continue; // wird über den manuellen Eingang verarbeitet
    var messages = thread.getMessages();
    for (var i = 0; i < messages.length; i++) {
      if (limitReached_(ctx)) {
        Logger.log('Limit erreicht, weitere automatisch erkannte Mails folgen im nächsten Lauf.');
        return;
      }
      var m = messages[i];
      var kind, pdfs;
      try {
        if (m.getDate().getTime() < since) continue;
        if (ctx.store.getMsgStatus(m.getId())) continue;
        if (m.isInTrash() || isOwnOutgoing_(m, ctx)) continue;

        var addr = senderAddress_(m);
        kind = isExcluded_(addr, ctx) ? 'excluded' : (known[addr] ? 'known' : 'unknown');
        if (kind === 'unknown' && !DETECT_UNKNOWN_SENDERS) continue;

        pdfs = pdfAttachments_(m);
        if (!pdfs.length) continue;
        var needsKeyword = kind === 'unknown' || (kind === 'excluded' && EXCLUDED_REQUIRE_INVOICE_KEYWORDS);
        if (needsKeyword && !looksLikeInvoice_(m, pdfs)) continue;
      } catch (e) {
        ctx.actions++;
        markError_(ctx, m, e);
        applyAutoLabels_(ctx, thread, m, false);
        continue;
      }

      ctx.actions++;
      var sent = handleMessage_(ctx, m, kind, pdfs);
      applyAutoLabels_(ctx, thread, m, sent);
    }
  }
}

function applyAutoLabels_(ctx, thread, message, sent) {
  if (DRY_RUN) {
    Logger.log('[DRY_RUN] Thread "' + thread.getFirstMessageSubject() + '": würde Label ' +
      (sent ? '"RG: Archiv"' : '"RG: Prüfen"') + ' setzen');
    return;
  }
  try {
    thread.addLabel(getOrCreateLabel_(sent ? LABEL_ARCHIVE : LABEL_REVIEW));
  } catch (e) {
    Logger.log('FEHLER beim Setzen des Labels für "' + message.getSubject() + '": ' + e.message);
  }
}

// =====================================================================================
// ENTSCHEIDUNG UND VERSAND PRO NACHRICHT
// =====================================================================================

/**
 * Verarbeitet genau eine Nachricht. mode: 'manual' | 'known' | 'excluded' | 'unknown'.
 * Gibt true zurück, wenn gesendet wurde (bzw. im DRY_RUN gesendet würde).
 * Fehler führen nie zum Abbruch, sondern zu "Prüfen".
 */
function handleMessage_(ctx, message, mode, pdfs) {
  var sent = false;
  var preview = DRY_RUN && message.getDate().getTime() < Number(ctx.store.getProp(PROP_INSTALL_TS)) && mode !== 'manual';
  try {
    if (mode === 'manual') learnSender_(ctx, senderAddress_(message));
    pdfs = pdfs || pdfAttachments_(message);
    var hashes = pdfs.map(sha256_);
    var decision = decide_(ctx, message, mode, pdfs, hashes);

    if (decision.send) {
      sendToSevdesk_(message, pdfs);
      sent = true;
      ctx.store.setMsg(message.getId(), 's');
      hashes.forEach(function (h) { ctx.store.addHash(h); });
      ctx.store.save();
      ctx.stats.sent++;
    } else {
      ctx.store.setMsg(message.getId(), 'p');
      ctx.store.save();
      ctx.stats.review++;
    }
    logDecision_(ctx, message, decision.send ? 'GESENDET' : 'PRÜFEN', decision.reason, preview);
  } catch (e) {
    if (sent) {
      ctx.stats.errors++;
      logDecision_(ctx, message, 'GESENDET', 'Fehler nach dem Versand: ' + e.message, preview);
    } else {
      markError_(ctx, message, e);
    }
  }
  return sent;
}

/** Fehler bei einer Nachricht: als "Prüfen" vermerken und loggen, Lauf geht weiter. */
function markError_(ctx, message, e) {
  ctx.stats.errors++;
  ctx.stats.review++;
  try {
    ctx.store.setMsg(message.getId(), 'p');
    ctx.store.save();
  } catch (ignore) {}
  try {
    logDecision_(ctx, message, 'PRÜFEN', 'Fehler: ' + e.message, false);
  } catch (ignore) {
    Logger.log('FEHLER bei einer Nachricht: ' + e.message);
  }
}

function decide_(ctx, message, mode, pdfs, hashes) {
  if (mode === 'excluded') {
    return review_('Ausnahmeadresse (weitergeleitete Rechnung), wird nie automatisch gesendet');
  }
  if (mode === 'unknown') {
    return review_('Unbekannter Absender, sieht nach Rechnung aus');
  }

  var dup = findDuplicate_(ctx, hashes);
  if (dup) return review_('Duplikat (PDF mit bekannter Prüfsumme: ' + dup.substr(0, 12) + '…)');

  if (mode === 'manual' && !MANUAL_OVERRIDES_CHECK) {
    if (pdfs.length) return send_('Manuell freigegeben (ohne PDF-Prüfung)');
    if (MANUAL_SEND_WITHOUT_PDF) return send_('Manuell freigegeben, kein PDF-Anhang');
    return review_('Kein PDF-Anhang');
  }

  if (!pdfs.length) return review_('Kein PDF-Anhang');

  var texts = [];
  for (var i = 0; i < pdfs.length; i++) {
    var text;
    try {
      text = pdfToText_(pdfs[i]);
    } catch (e) {
      return review_('PDF nicht lesbar (' + pdfs[i].getName() + '): ' + e.message);
    }
    if (!text || text.replace(/\s/g, '').length < MIN_TEXT_LENGTH) {
      return review_('PDF ohne erkennbaren Text (' + pdfs[i].getName() + ')');
    }
    texts.push(text);
  }

  var result = classifyRecipient_(texts.join('\n'));
  var prefix = mode === 'manual' ? 'Manuell, PDF-Prüfung: ' : 'Bekannter Absender, PDF-Prüfung: ';
  if (result.type === 'UG') return send_(prefix + 'Rechnungsempfänger 1M4 UG (' + result.marker + ')');
  if (result.type === 'OTHER') return review_(prefix + 'andere Gesellschaft (' + result.marker + '), kein UG-Merkmal');
  return review_(prefix + 'Rechnungsempfänger nicht eindeutig erkennbar');
}

function send_(reason) { return { send: true, reason: reason }; }
function review_(reason) { return { send: false, reason: reason }; }

function findDuplicate_(ctx, hashes) {
  for (var i = 0; i < hashes.length; i++) {
    if (ctx.store.hasHash(hashes[i])) return hashes[i];
  }
  return null;
}

/**
 * Prüft den PDF-Text auf den Rechnungsempfänger.
 * Rückgabe: { type: 'UG' | 'OTHER' | 'UNKNOWN', marker: string }
 */
function classifyRecipient_(text) {
  var t = String(text).normalize('NFC').replace(/ /g, ' ');
  var compact = t.toUpperCase().replace(/[^A-Z0-9]/g, '');

  for (var i = 0; i < UG_NAME_PATTERNS.length; i++) {
    var match = t.match(UG_NAME_PATTERNS[i]);
    if (match) return { type: 'UG', marker: match[0].replace(/\s+/g, ' ') };
  }
  for (var j = 0; j < UG_VAT_IDS.length; j++) {
    if (compact.indexOf(UG_VAT_IDS[j]) !== -1) return { type: 'UG', marker: UG_VAT_IDS[j] };
  }
  for (var k = 0; k < OTHER_COMPANY_PATTERNS.length; k++) {
    if (OTHER_COMPANY_PATTERNS[k].re.test(t)) return { type: 'OTHER', marker: OTHER_COMPANY_PATTERNS[k].name };
  }
  return { type: 'UNKNOWN', marker: '' };
}

function sendToSevdesk_(message, pdfs) {
  if (DRY_RUN) return;
  // GmailApp.sendEmail statt message.forward(): forward() hängt die Weiterleitung in den
  // Original-Thread und sendet immer alle Anhänge mit. sendEmail erzeugt einen eigenen Thread.
  var subject = message.getSubject();
  if (!/^(Fwd|FW|WG):/i.test(subject)) subject = 'Fwd: ' + subject;

  var headerPlain =
    '---------- Weitergeleitete Nachricht ----------\n' +
    'Von: ' + message.getFrom() + '\n' +
    'Datum: ' + message.getDate() + '\n' +
    'Betreff: ' + message.getSubject() + '\n' +
    'An: ' + message.getTo() + '\n\n';
  var headerHtml =
    '<p>---------- Weitergeleitete Nachricht ----------<br>' +
    'Von: ' + escapeHtml_(message.getFrom()) + '<br>' +
    'Datum: ' + message.getDate() + '<br>' +
    'Betreff: ' + escapeHtml_(message.getSubject()) + '<br>' +
    'An: ' + escapeHtml_(message.getTo()) + '</p><br>';

  var attachments = SEND_ONLY_PDF_ATTACHMENTS
    ? pdfs
    : message.getAttachments({ includeInlineImages: false, includeAttachments: true });

  GmailApp.sendEmail(FORWARD_TO, subject, headerPlain + message.getPlainBody(), {
    from: FORWARD_FROM,
    htmlBody: headerHtml + message.getBody(),
    attachments: attachments
  });
}

// =====================================================================================
// ABSENDER
// =====================================================================================

function learnSender_(ctx, addr) {
  if (!addr) return;
  if (isExcluded_(addr, ctx)) {
    Logger.log('Absender ' + addr + ' wird nicht gelernt (Ausnahmeadresse).');
    return;
  }
  if (ctx.store.knownSenders()[addr]) return;
  ctx.store.addSender(addr);
  Logger.log((DRY_RUN ? '[DRY_RUN] Absender würde gelernt: ' : 'Absender gelernt: ') + addr);
}

function isExcluded_(addr, ctx) {
  return EXCLUDED_SENDERS.indexOf(addr) !== -1 || !!ctx.own[addr];
}

function ownAddresses_() {
  var own = {};
  own[Session.getEffectiveUser().getEmail().toLowerCase()] = true;
  GmailApp.getAliases().forEach(function (a) { own[a.toLowerCase()] = true; });
  return own;
}

/** Eigene ausgehende Nachricht (z. B. die Weiterleitungen an sevDesk) -> ignorieren. */
function isOwnOutgoing_(message, ctx) {
  if (!ctx.own[senderAddress_(message)]) return false;
  var recipients = extractAddresses_(message.getTo() + ',' + message.getCc());
  return !recipients.some(function (r) { return ctx.own[r]; });
}

function senderAddress_(message) {
  var list = extractAddresses_(message.getFrom());
  return list.length ? list[list.length - 1] : '';
}

function extractAddresses_(s) {
  var found = String(s || '').match(/[a-z0-9._%+'\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) || [];
  return found.map(function (a) { return a.toLowerCase(); });
}

// =====================================================================================
// ANHÄNGE, PRÜFSUMMEN, OCR
// =====================================================================================

function pdfAttachments_(message) {
  return message.getAttachments({ includeInlineImages: false, includeAttachments: true })
    .filter(function (a) {
      return a.getContentType() === 'application/pdf' || /\.pdf$/i.test(a.getName() || '');
    });
}

function looksLikeInvoice_(message, pdfs) {
  if (INVOICE_KEYWORDS.test(message.getSubject() || '')) return true;
  return pdfs.some(function (p) { return INVOICE_KEYWORDS.test(p.getName() || ''); });
}

/** SHA-256 der PDF-Bytes, Base64 (websafe, ohne "="). */
function sha256_(blob) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes());
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

/**
 * PDF -> Text über den erweiterten Drive-Dienst (Konvertierung in ein Google Doc mit OCR).
 * Die temporäre Datei wird sofort endgültig gelöscht (nicht Papierkorb).
 */
function pdfToText_(blob) {
  var file = null;
  try {
    file = Drive.Files.create(
      { name: TEMP_FILE_PREFIX + Date.now(), mimeType: MimeType.GOOGLE_DOCS },
      blob.copyBlob().setContentType(MimeType.PDF),
      { ocrLanguage: OCR_LANGUAGE, fields: 'id' }
    );
    try {
      return DocumentApp.openById(file.id).getBody().getText();
    } catch (e) {
      Utilities.sleep(1500); // Doc ist direkt nach der Konvertierung gelegentlich noch nicht verfügbar
      return DocumentApp.openById(file.id).getBody().getText();
    }
  } finally {
    if (file && file.id) {
      try {
        Drive.Files.remove(file.id);
      } catch (e) {
        Logger.log('WARNUNG: Temporäre OCR-Datei ' + file.id + ' konnte nicht gelöscht werden: ' + e.message);
      }
    }
  }
}

/** Sicherheitsnetz: liegengebliebene OCR-Dateien (z. B. nach Zeitüberschreitung) endgültig löschen. */
function cleanupTempFiles_() {
  try {
    var res = Drive.Files.list({
      q: "name contains '" + TEMP_FILE_PREFIX + "' and 'me' in owners",
      fields: 'files(id,name)',
      pageSize: 100
    });
    (res.files || []).forEach(function (f) {
      if (f.name.indexOf(TEMP_FILE_PREFIX) !== 0) return;
      Drive.Files.remove(f.id);
      Logger.log('Liegengebliebene OCR-Datei gelöscht: ' + f.name);
    });
  } catch (e) {
    Logger.log('WARNUNG: Aufräumen temporärer OCR-Dateien fehlgeschlagen: ' + e.message);
  }
}

// =====================================================================================
// SPEICHER (Script Properties)
// =====================================================================================
// MSG_n: "messageId:status:tag" (status s = gesendet, p = Prüfen, a = Archiv beim ersten Lauf)
// SHA_n: "prüfsumme:tag:k" (k = 1 aus Archiv-Registrierung, wird nie gelöscht)
// SND_n: gelernte Absenderadressen
// tag = Tage seit 1970 (Base36). Werte werden auf mehrere Properties verteilt (je max. 8000 Zeichen).

function Store_() {}

Store_.load = function () {
  var s = new Store_();
  s.props = PropertiesService.getScriptProperties();
  s.all = s.props.getProperties();
  s.msgs = {};
  s.hashes = {};
  s.senders = {};
  s.dirty = {};
  readShards_(s.all, SHARD_MSG).forEach(function (e) {
    var p = e.split(':');
    s.msgs[p[0]] = { st: p[1], d: p[2] };
  });
  readShards_(s.all, SHARD_SHA).forEach(function (e) {
    var p = e.split(':');
    s.hashes[p[0]] = { d: p[1], k: p[2] === '1' };
  });
  readShards_(s.all, SHARD_SENDERS).forEach(function (e) { s.senders[e] = true; });
  return s;
};

Store_.prototype.getProp = function (key) { return this.all[key] || null; };

Store_.prototype.setProp = function (key, value) {
  this.props.setProperty(key, value);
  this.all[key] = value;
};

Store_.prototype.getMsgStatus = function (id) { return this.msgs[id] ? this.msgs[id].st : null; };

Store_.prototype.setMsg = function (id, status) {
  this.msgs[id] = { st: status, d: today36_() };
  this.dirty[SHARD_MSG] = true;
};

Store_.prototype.hasHash = function (h) { return !!this.hashes[h]; };

Store_.prototype.addHash = function (h, fromArchive) {
  var keep = fromArchive || (this.hashes[h] && this.hashes[h].k);
  this.hashes[h] = { d: today36_(), k: !!keep };
  this.dirty[SHARD_SHA] = true;
};

Store_.prototype.knownSenders = function () {
  var known = {};
  INITIAL_SENDERS.forEach(function (a) { known[a.toLowerCase()] = true; });
  Object.keys(this.senders).forEach(function (a) { known[a] = true; });
  return known;
};

Store_.prototype.addSender = function (addr) {
  this.senders[addr] = true;
  this.dirty[SHARD_SENDERS] = true;
};

Store_.prototype.removeSender = function (addr) {
  delete this.senders[addr];
  this.dirty[SHARD_SENDERS] = true;
};

Store_.prototype.prune = function () {
  var limit = parseInt(today36_(), 36) - RETENTION_DAYS;
  var self = this;
  Object.keys(this.msgs).forEach(function (id) {
    var e = self.msgs[id];
    if (e.st !== 'a' && parseInt(e.d, 36) < limit) {
      delete self.msgs[id];
      self.dirty[SHARD_MSG] = true;
    }
  });
  Object.keys(this.hashes).forEach(function (h) {
    var e = self.hashes[h];
    if (!e.k && parseInt(e.d, 36) < limit) {
      delete self.hashes[h];
      self.dirty[SHARD_SHA] = true;
    }
  });
};

/** Schreibt geänderte Daten. Im DRY_RUN nur mit force (Erstregistrierung des Archivs). */
Store_.prototype.save = function (force) {
  if (DRY_RUN && !force) return;
  var self = this;
  if (this.dirty[SHARD_MSG]) {
    writeShards_(this, SHARD_MSG, Object.keys(this.msgs).map(function (id) {
      return id + ':' + self.msgs[id].st + ':' + self.msgs[id].d;
    }));
  }
  if (this.dirty[SHARD_SHA]) {
    writeShards_(this, SHARD_SHA, Object.keys(this.hashes).map(function (h) {
      return h + ':' + self.hashes[h].d + ':' + (self.hashes[h].k ? '1' : '0');
    }));
  }
  if (this.dirty[SHARD_SENDERS]) {
    writeShards_(this, SHARD_SENDERS, Object.keys(this.senders));
  }
  this.dirty = {};

  var size = 0;
  Object.keys(this.all).forEach(function (k) { size += k.length + String(self.all[k]).length; });
  if (size > 400000) {
    Logger.log('WARNUNG: Script Properties belegen ' + Math.round(size / 1024) + ' KB von max. 500 KB. RETENTION_DAYS verringern.');
  }
};

function readShards_(all, prefix) {
  var keys = Object.keys(all).filter(function (k) { return k.indexOf(prefix) === 0; });
  keys.sort(function (a, b) { return Number(a.substr(prefix.length)) - Number(b.substr(prefix.length)); });
  var entries = [];
  keys.forEach(function (k) {
    all[k].split(',').forEach(function (e) { if (e) entries.push(e); });
  });
  return entries;
}

function writeShards_(store, prefix, entries) {
  var chunks = [];
  var current = '';
  entries.forEach(function (e) {
    if (current && current.length + 1 + e.length > SHARD_MAX_CHARS) {
      chunks.push(current);
      current = '';
    }
    current = current ? current + ',' + e : e;
  });
  if (current) chunks.push(current);

  var update = {};
  chunks.forEach(function (c, i) { update[prefix + i] = c; });
  store.props.setProperties(update, false);
  Object.keys(update).forEach(function (k) { store.all[k] = update[k]; });

  Object.keys(store.all).forEach(function (k) {
    if (k.indexOf(prefix) === 0 && Number(k.substr(prefix.length)) >= chunks.length) {
      store.props.deleteProperty(k);
      delete store.all[k];
    }
  });
}

// =====================================================================================
// HILFSFUNKTIONEN
// =====================================================================================

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function threadHasLabel_(thread, name) {
  return thread.getLabels().some(function (l) { return l.getName() === name; });
}

function limitReached_(ctx) {
  return ctx.actions >= MAX_MESSAGES_PER_RUN || timeUp_(ctx);
}

function timeUp_(ctx) {
  return Date.now() - ctx.start > MAX_RUNTIME_MS;
}

function today36_() {
  return Math.floor(Date.now() / 86400000).toString(36);
}

function formatDate_(date, tz) {
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd HH:mm');
}

function escapeHtml_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Log: Datum | Absender | Betreff | Ergebnis | Grund */
function logDecision_(ctx, message, result, reason, preview) {
  var prefix = DRY_RUN ? '[DRY_RUN] ' : '';
  var shown = DRY_RUN ? (result === 'GESENDET' ? 'WÜRDE SENDEN' : 'WÜRDE PRÜFEN') : result;
  if (preview) reason += ' [Vorschau: vor Installationsdatum, wird im Produktivbetrieb ignoriert]';
  Logger.log(prefix + [
    formatDate_(message.getDate(), ctx.tz),
    message.getFrom(),
    message.getSubject(),
    shown,
    reason
  ].join(' | '));
}

// =====================================================================================
// EINRICHTUNG UND PFLEGE (manuell im Editor ausführen)
// =====================================================================================

/**
 * Einmalig ausführen: Legt den stündlichen Trigger an (löscht zuvor evtl.
 * vorhandene Trigger für diese Funktion, damit sie nicht doppelt läuft).
 */
function createHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processRechnungenEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('processRechnungenEmails').timeBased().everyHours(1).create();
  Logger.log('Stündlicher Trigger für "processRechnungenEmails" wurde erstellt.');
}

/** Zeigt den gespeicherten Zustand (Installationsdatum, Zähler, gelernte Absender). */
function showState() {
  var s = Store_.load();
  var counts = { s: 0, p: 0, a: 0 };
  Object.keys(s.msgs).forEach(function (id) { counts[s.msgs[id].st] = (counts[s.msgs[id].st] || 0) + 1; });
  var install = s.getProp(PROP_INSTALL_TS);
  Logger.log('DRY_RUN: ' + DRY_RUN);
  Logger.log('Installationsdatum: ' + (install ? formatDate_(new Date(Number(install)), Session.getScriptTimeZone()) : '(noch nicht gesetzt)'));
  Logger.log('Erstregistrierung Archiv abgeschlossen: ' + (s.getProp(PROP_INIT_DONE) ? 'ja' : 'nein'));
  Logger.log('Message-IDs: ' + counts.s + ' gesendet, ' + counts.p + ' Prüfen, ' + counts.a + ' aus Archiv');
  Logger.log('PDF-Prüfsummen: ' + Object.keys(s.hashes).length);
  Logger.log('Gelernte Absender (' + Object.keys(s.senders).length + '): ' + Object.keys(s.senders).sort().join(', '));
  Logger.log('Startbestand (' + INITIAL_SENDERS.length + '): ' + INITIAL_SENDERS.join(', '));
}

/** Entfernt die in SENDERS_TO_REMOVE eingetragenen Adressen aus der gelernten Absenderliste. */
function removeLearnedSenders() {
  var s = Store_.load();
  SENDERS_TO_REMOVE.forEach(function (a) {
    a = a.toLowerCase();
    if (s.senders[a]) {
      s.removeSender(a);
      Logger.log('Entfernt: ' + a);
    } else {
      Logger.log('Nicht in der gelernten Liste: ' + a + (INITIAL_SENDERS.indexOf(a) !== -1 ? ' (steht im Startbestand INITIAL_SENDERS im Code)' : ''));
    }
  });
  s.save(true);
}

/** Listet alle Gmail-Labels exakt so auf, wie Google sie speichert. */
function listLabels() {
  GmailApp.getUserLabels().forEach(function (label) {
    Logger.log('"' + label.getName() + '"');
  });
}
