/*
 * Lokaler Test von Code.gs mit nachgebauten Apps-Script-Diensten (Gmail, Drive, Properties ...).
 * Aufruf: node test/run-tests.js
 * Mock-PDFs tragen ihren "OCR-Text" direkt im Feld text (null = nicht lesbar).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const DAY = 86400000;
const OWN = 'h.g.w.rieger@gmail.com';

let idCounter = 1;
function pdf(name, text, bytes) {
  return { name, type: 'application/pdf', text, bytes: bytes || ('PDF:' + name + ':' + text) };
}

function makeWorld() {
  const w = { labels: new Map(), threads: [], sent: [], drive: new Map(), props: {}, logs: [], driveCreated: 0, now: Date.now() };

  function makeLabel(name) {
    const l = {
      name,
      getName: () => name,
      getThreads: (start, max) => w.threads.filter(t => t.labels.has(name)).slice(start, start + max).map(t => t.api)
    };
    w.labels.set(name, l);
    return l;
  }
  w.makeLabel = makeLabel;

  w.addThread = function (labels) {
    const t = { messages: [], labels: new Set(labels || []), read: false };
    t.api = {
      getMessages: () => t.messages.map(m => m.api),
      getLabels: () => [...t.labels].map(n => w.labels.get(n) || makeLabel(n)),
      addLabel: l => { t.labels.add(l.getName()); },
      removeLabel: l => { t.labels.delete(l.getName()); },
      markRead: () => { t.read = true; },
      getFirstMessageSubject: () => (t.messages[0] ? t.messages[0].subject : '')
    };
    w.threads.unshift(t);
    return t;
  };

  w.addMessage = function (thread, o) {
    const m = Object.assign({ id: 'm' + (idCounter++), to: 'info@1m4.de', cc: '', date: new Date(), attachments: [], trash: false }, o);
    m.api = {
      getId: () => m.id,
      getFrom: () => m.from,
      getTo: () => m.to,
      getCc: () => m.cc,
      getSubject: () => m.subject,
      getDate: () => m.date,
      isInTrash: () => m.trash,
      getPlainBody: () => 'Text',
      getBody: () => '<p>Text</p>',
      getAttachments: () => {
        if (m.throwOnAttachments) throw new Error('Anhang konnte nicht geladen werden');
        return m.attachments.map(blob);
      }
    };
    thread.messages.push(m);
    return m;
  };

  function blob(a) {
    const b = {
      _a: a,
      getName: () => a.name,
      getContentType: () => a.type,
      getBytes: () => Buffer.from(a.bytes),
      copyBlob: () => b,
      setContentType: () => b
    };
    return b;
  }

  const Logger = { log: s => { w.logs.push(String(s)); } };
  const store = w.props;
  const scriptProps = {
    getProperties: () => Object.assign({}, store),
    getProperty: k => (k in store ? store[k] : null),
    setProperty: (k, v) => { check(k, v); store[k] = String(v); },
    setProperties: (o) => { Object.keys(o).forEach(k => { check(k, o[k]); store[k] = String(o[k]); }); },
    deleteProperty: k => { delete store[k]; }
  };
  function check(k, v) {
    if (Buffer.byteLength(String(v)) > 9 * 1024) throw new Error('Property zu groß: ' + k);
  }

  const ctx = {
    Logger,
    console,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => scriptProps },
    Session: { getEffectiveUser: () => ({ getEmail: () => OWN }), getScriptTimeZone: () => 'Europe/Berlin' },
    MimeType: { GOOGLE_DOCS: 'application/vnd.google-apps.document', PDF: 'application/pdf' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, bytes) => [...crypto.createHash('sha256').update(Buffer.from(bytes)).digest()].map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: arr => Buffer.from(arr.map(b => (b + 256) % 256)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      formatDate: d => d.toISOString().slice(0, 16).replace('T', ' '),
      sleep: () => {}
    },
    GmailApp: {
      getUserLabelByName: n => w.labels.get(n) || null,
      createLabel: n => makeLabel(n),
      getAliases: () => ['info@1m4.de', 'info@1m4.eu'],
      getUserLabels: () => [...w.labels.values()],
      search: (q, start, max) => {
        const after = Number((q.match(/after:(\d+)/) || [])[1] || 0) * 1000;
        return w.threads.filter(t => t.messages.some(m =>
          !m.trash && m.date.getTime() >= after && m.attachments.some(a => /\.pdf$/i.test(a.name))
        )).slice(start, start + max).map(t => t.api);
      },
      sendEmail: (to, subject, body, opts) => {
        w.sent.push({ to, subject, from: opts.from, attachments: opts.attachments.map(a => a.getName()) });
      }
    },
    Drive: {
      Files: {
        create: (res, b) => {
          const id = 'f' + (idCounter++);
          w.driveCreated++;
          w.drive.set(id, { name: res.name, text: b._a.text });
          return { id };
        },
        remove: id => { w.drive.delete(id); },
        list: () => ({ files: [...w.drive.entries()].map(([id, f]) => ({ id, name: f.name })) })
      }
    },
    DocumentApp: {
      openById: id => {
        const f = w.drive.get(id);
        if (f.text === null) throw new Error('Konvertierung fehlgeschlagen');
        return { getBody: () => ({ getText: () => f.text }) };
      }
    },
    ScriptApp: {}
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  w.ctx = ctx;
  w.run = function (overrides) {
    Object.assign(ctx, overrides || {});
    w.logs.length = 0;
    ctx.processRechnungenEmails();
    return w.logs.slice();
  };
  return w;
}

const IN = 'Buisness/[99] Buha/[01] RG: Eingang';
const AR = 'Buisness/[99] Buha/[02] RG: Archiv';
const PR = 'Buisness/[99] Buha/[03] RG: Prüfen';
const UG_TEXT = 'Rechnung an 1M4 UG (haftungsbeschränkt) Strandweg 16 17213 Göhren-Lebbin';
const OU_TEXT = 'Invoice to 1M4 OÜ, Järvevana tee 9, Tallinn, VAT EE102345678';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('OK    ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL  ' + name + '\n      ' + e.message);
  }
}
const logHas = (logs, re) => logs.some(l => re.test(l));

// ---------------------------------------------------------------------------------------
// Szenario: echter Ausgangszustand + neue Mails nach Installation
// ---------------------------------------------------------------------------------------
function setupWorld() {
  const w = makeWorld();
  w.makeLabel(IN); w.makeLabel(AR);
  const past = new Date(Date.now() - 7 * DAY);
  // De-Witte-Thread, bereits archiviert (wie INV/26011681)
  const tDW = w.addThread([AR]);
  w.addMessage(tDW, { from: 'caroline@dewitte.com', subject: 'Rechnung INV/26011681 - DE WITTE AG', date: past, attachments: [pdf('INV_26011681.pdf', UG_TEXT, 'DEWITTE-INV-26011681')] });
  // Alte Mail eines bekannten Lieferanten vor Installation, nicht archiviert
  const tOld = w.addThread([]);
  w.addMessage(tOld, { from: 'info@praxisdienst.de', subject: 'Rechnung 4711', date: past, attachments: [pdf('RE4711.pdf', UG_TEXT)] });
  return { w, tDW, tOld };
}

test('DRY_RUN: Erstregistrierung, nichts gesendet, keine Labels geändert, nichts gelernt', () => {
  const { w, tDW } = setupWorld();
  const t = w.addThread([IN]);
  w.addMessage(t, { from: 'Neu GmbH <billing@neu-lieferant.de>', subject: 'Ihre Rechnung', attachments: [pdf('r.pdf', OU_TEXT)] });
  const logs = w.run();
  assert.strictEqual(w.sent.length, 0, 'gesendet');
  assert.ok(t.labels.has(IN) && !t.labels.has(AR), 'Label geändert');
  assert.ok(!w.labels.has(PR), 'Prüfen-Label angelegt');
  assert.ok(w.props.INSTALL_TS && w.props.ARCHIVE_INIT_DONE, 'Init fehlt');
  assert.ok(!w.props.SND_0, 'Absender gespeichert');
  assert.ok(/:a:/.test(w.props.MSG_0) && !/:s:/.test(w.props.MSG_0 || ''), 'nur Archiv-IDs gespeichert');
  assert.ok(logHas(logs, /\[DRY_RUN\].*WÜRDE SENDEN.*Manuell freigegeben/), 'Log');
  assert.ok(logHas(logs, /Absender würde gelernt: billing@neu-lieferant.de/));
  assert.ok(logHas(logs, /Rechnung 4711.*Vorschau/), 'Vorschau alter Mails im DRY_RUN');
  assert.ok(tDW.labels.has(AR));
});

const { w, tDW, tOld } = setupWorld();
w.run(); // erster Lauf (DRY_RUN) -> Installation
w.ctx.DRY_RUN = false;

// neue Mails nach Installation
const now = () => new Date();
const tUG = w.addThread(['Lieferanten/Datev']);
const mUG = w.addMessage(tUG, { from: 'DATEV <e-invoice@datev.de>', subject: 'Rechnung 2026-100', date: now(), attachments: [pdf('RE-2026-100.pdf', UG_TEXT), pdf('AGB.pdf', 'Allgemeine Geschäftsbedingungen bla bla bla')] });
const tOU = w.addThread([]);
const mOU = w.addMessage(tOU, { from: 'accounting.estonia@ellex.legal', subject: 'Invoice 55', date: now(), attachments: [pdf('inv55.pdf', OU_TEXT)] });
const tSab = w.addThread([]);
const mSab = w.addMessage(tSab, { from: 'Sabina <sabina.rieger73@gmail.com>', to: OWN, subject: 'Fwd: irgendwas', date: now(), attachments: [pdf('scan.pdf', UG_TEXT)] });
const mDWdup = w.addMessage(tDW, { from: 'caroline@dewitte.com', subject: 'Rechnung INV/26011681 - DE WITTE AG', date: now(), attachments: [pdf('INV_26011681.pdf', UG_TEXT, 'DEWITTE-INV-26011681')] });
const tNoPdf = w.addThread([]);
w.addMessage(tNoPdf, { from: 'info@wir-machen-druck.de', subject: 'Versandbestätigung', date: now(), attachments: [] });
const tUnk = w.addThread([]);
const mUnk = w.addMessage(tUnk, { from: 'shop@unbekannt.de', subject: 'Ihre Rechnung Nr. 9', date: now(), attachments: [pdf('doc.pdf', UG_TEXT)] });
const tUnk2 = w.addThread([]);
w.addMessage(tUnk2, { from: 'news@unbekannt.de', subject: 'Katalog Herbst', date: now(), attachments: [pdf('katalog.pdf', 'Katalog')] });
const tScan = w.addThread([]);
const mScan = w.addMessage(tScan, { from: 'import@transmaritim.com', subject: 'Invoice', date: now(), attachments: [pdf('scan.pdf', null)] });
const tPriv = w.addThread([]);
const mPriv = w.addMessage(tPriv, { from: 'claudia.lehmann@olw.de', subject: 'Rechnung', date: now(), attachments: [pdf('r.pdf', 'Herrn Helmut Rieger, Strandweg 16, 17213 Göhren-Lebbin, Rechnung Nr 1')] });
const tVat = w.addThread([]);
const mVat = w.addMessage(tVat, { from: 'sales@thesolutionshop.nl', subject: 'Factuur 12', date: now(), attachments: [pdf('f.pdf', 'Factuur aan klant BTW-nr. DE 323 762 513 bedrag 100')] });
const tOwn = w.addThread([]);
w.addMessage(tOwn, { from: 'info@1m4.de', to: 'autobox@sevdesk.email', subject: 'Fwd: Rechnung 2026-99', date: now(), attachments: [pdf('RE-99.pdf', UG_TEXT)] });
const tErr = w.addThread([]);
const mErr = w.addMessage(tErr, { from: 'rechnungsstelle@1und1.de', subject: 'Rechnung', date: now(), attachments: [pdf('x.pdf', UG_TEXT)], throwOnAttachments: true });
// Manuell: neuer Lieferant ohne Prüfung, und manuell ohne PDF
const tMan = w.addThread([IN]);
const mMan = w.addMessage(tMan, { from: 'Neu GmbH <billing@neu-lieferant.de>', subject: 'Ihre Rechnung', date: now(), attachments: [pdf('r1.pdf', OU_TEXT)] });
const tManNoPdf = w.addThread([IN]);
const mManNoPdf = w.addMessage(tManNoPdf, { from: 'service@portal.de', subject: 'Beleg online', date: now(), attachments: [] });
// Manuell: Weiterleitung von Sabina
const tManSab = w.addThread([IN]);
const mManSab = w.addMessage(tManSab, { from: 'sabina.rieger73@gmail.com', subject: 'Fwd: Rechnung Handwerker', date: now(), attachments: [pdf('hw.pdf', 'Rechnung an Helmut Rieger')] });

w.ctx.MAX_MESSAGES_PER_RUN = 50;
const logs1 = w.run();
const sentIds = () => w.sent.map(s => s.subject);
const statusOf = id => { const m = (w.props.MSG_0 || '').match(new RegExp(id + ':(\\w)')); return m && m[1]; };

test('UG-Rechnung (bekannter Absender, ohne Filter) -> gesendet von info@1m4.de, nur PDFs, Archiv', () => {
  const s = w.sent.find(x => x.subject === 'Fwd: Rechnung 2026-100');
  assert.ok(s, 'nicht gesendet');
  assert.strictEqual(s.from, 'info@1m4.de');
  assert.strictEqual(s.to, 'autobox@sevdesk.email');
  assert.deepStrictEqual(s.attachments, ['RE-2026-100.pdf', 'AGB.pdf']);
  assert.ok(tUG.labels.has(AR) && tUG.labels.has('Lieferanten/Datev'), 'Labels');
  assert.strictEqual(statusOf(mUG.id), 's');
});
test('OÜ-Rechnung (bekannter Absender) -> nicht gesendet, Prüfen', () => {
  assert.ok(!sentIds().includes('Fwd: Invoice 55'));
  assert.ok(tOU.labels.has(PR));
  assert.ok(logHas(logs1, /Invoice 55 \| PRÜFEN \| .*andere Gesellschaft \(1M4 OÜ\)/));
});
test('Weiterleitung von Sabina (automatisch) -> Prüfen, nicht gelernt', () => {
  assert.ok(!sentIds().includes('Fwd: irgendwas'));
  assert.ok(tSab.labels.has(PR));
  assert.ok(!/sabina/.test(w.props.SND_0 || ''));
});
test('Duplikat: neue Mail im archivierten Thread mit gleichem PDF -> Prüfen "Duplikat", alte Mail nicht erneut', () => {
  assert.strictEqual(w.sent.filter(s => /26011681/.test(s.subject)).length, 0);
  assert.ok(tDW.labels.has(PR) && tDW.labels.has(AR));
  assert.ok(logHas(logs1, /26011681.*PRÜFEN.*Duplikat/));
  assert.strictEqual(statusOf(mDWdup.id), 'p');
});
test('Mail ohne PDF (bekannter Absender) -> automatisch ignoriert', () => {
  assert.ok(!logHas(logs1, /Versandbestätigung/));
  assert.strictEqual(tNoPdf.labels.size, 0);
});
test('Unbekannter Absender: Rechnungs-Stichwort -> Prüfen, sonst ignoriert', () => {
  assert.ok(tUnk.labels.has(PR) && !sentIds().includes('Fwd: Ihre Rechnung Nr. 9'));
  assert.strictEqual(tUnk2.labels.size, 0);
});
test('PDF nicht lesbar -> Prüfen', () => {
  assert.ok(tScan.labels.has(PR) && logHas(logs1, /PDF nicht lesbar/));
});
test('Nur Strandweg-Adresse (Privatadresse) -> kein UG-Merkmal -> Prüfen', () => {
  assert.ok(tPriv.labels.has(PR) && logHas(logs1, /claudia.*nicht eindeutig/));
});
test('USt-IdNr. mit Leerzeichen "DE 323 762 513" -> gesendet', () => {
  assert.ok(sentIds().includes('Fwd: Factuur 12') && tVat.labels.has(AR));
});
test('Eigene Weiterleitung an sevDesk wird nicht erneut verarbeitet', () => {
  assert.ok(!sentIds().includes('Fwd: Rechnung 2026-99'));
  assert.strictEqual(tOwn.labels.size, 0);
});
test('Fehler bei einer Mail -> Prüfen, Lauf läuft weiter', () => {
  assert.ok(tErr.labels.has(PR) && logHas(logs1, /Fehler: Anhang konnte nicht geladen werden/));
  assert.strictEqual(statusOf(mErr.id), 'p');
});
test('Manuell: neuer Lieferant -> ohne PDF-Prüfung gesendet (auch OÜ-Text), Absender gelernt, Archiv', () => {
  assert.ok(sentIds().includes('Fwd: Ihre Rechnung'));
  assert.ok(/billing@neu-lieferant\.de/.test(w.props.SND_0));
  assert.ok(!tMan.labels.has(IN) && tMan.labels.has(AR) && tMan.read);
});
test('Manuell ohne PDF -> gesendet (MANUAL_SEND_WITHOUT_PDF)', () => {
  assert.ok(sentIds().includes('Fwd: Beleg online') && tManNoPdf.labels.has(AR));
});
test('Manuell: Weiterleitung von Sabina -> gesendet, aber nicht gelernt', () => {
  assert.ok(sentIds().includes('Fwd: Rechnung Handwerker'));
  assert.ok(!/sabina/.test(w.props.SND_0));
  assert.ok(logHas(logs1, /sabina.* wird nicht gelernt/));
});
test('Alte Mail vor Installationsdatum wird im Produktivbetrieb ignoriert', () => {
  assert.ok(!logHas(logs1, /Rechnung 4711/) && tOld.labels.size === 0);
});
test('Keine temporären Drive-Dateien bleiben zurück', () => {
  assert.ok(w.driveCreated > 0);
  assert.strictEqual(w.drive.size, 0);
});

test('Zweiter Lauf: nichts wird erneut gesendet', () => {
  const before = w.sent.length;
  const logs = w.run();
  assert.strictEqual(w.sent.length, before);
  assert.ok(logHas(logs, /0 gesendet, 0 nach "Prüfen"/));
});

test('Neue Mail in altem Thread (neue Rechnung) -> nur die neue Nachricht wird gesendet, genau einmal', () => {
  const before = w.sent.length;
  w.addMessage(tUG, { from: 'e-invoice@datev.de', subject: 'Rechnung 2026-101', date: now(), attachments: [pdf('RE-2026-101.pdf', UG_TEXT)] });
  w.run();
  const newSent = w.sent.slice(before).map(s => s.subject);
  assert.deepStrictEqual(newSent, ['Fwd: Rechnung 2026-101']);
  w.run();
  assert.strictEqual(w.sent.length, before + 1);
});

test('Gelernter Absender wird danach automatisch erkannt (und geprüft)', () => {
  const t = w.addThread([]);
  w.addMessage(t, { from: 'billing@neu-lieferant.de', subject: 'Rechnung 2', date: now(), attachments: [pdf('r2.pdf', UG_TEXT)] });
  w.run();
  assert.ok(sentIds().includes('Fwd: Rechnung 2') && t.labels.has(AR));
});

test('Neue Mail in archiviertem Thread mit Eingang-Label (Gmail-Filter) -> alte nicht erneut, neue einmal', () => {
  const before = w.sent.length;
  tMan.labels.add(IN);
  w.addMessage(tMan, { from: 'billing@neu-lieferant.de', subject: 'Ihre Rechnung', date: now(), attachments: [pdf('r3.pdf', UG_TEXT)] });
  w.run();
  assert.strictEqual(w.sent.length, before + 1);
  assert.ok(!tMan.labels.has(IN));
});

test('Prüfen-Mail manuell nach Eingang verschoben -> wird freigegeben und gesendet', () => {
  const before = w.sent.length;
  tOU.labels.delete(PR); tOU.labels.add(IN);
  w.run();
  assert.strictEqual(w.sent.length, before + 1);
  assert.ok(tOU.labels.has(AR) && !tOU.labels.has(PR) && !tOU.labels.has(IN));
});

test('Duplikat auch bei manueller Freigabe nicht gesendet', () => {
  const before = w.sent.length;
  const t = w.addThread([IN]);
  w.addMessage(t, { from: 'e-invoice@datev.de', subject: 'Rechnung 2026-100 (Kopie)', date: now(), attachments: [pdf('RE-2026-100.pdf', UG_TEXT)] });
  w.run();
  assert.strictEqual(w.sent.length, before);
  assert.ok(t.labels.has(PR));
});

test('MANUAL_OVERRIDES_CHECK = true: manuelle OÜ-Rechnung -> Prüfen', () => {
  const before = w.sent.length;
  const t = w.addThread([IN]);
  w.addMessage(t, { from: 'x@lieferant-b.de', subject: 'Invoice B', date: now(), attachments: [pdf('b.pdf', OU_TEXT.replace('EE102345678', ''))] });
  w.run({ MANUAL_OVERRIDES_CHECK: true });
  w.ctx.MANUAL_OVERRIDES_CHECK = false;
  assert.strictEqual(w.sent.length, before);
  assert.ok(t.labels.has(PR) && !t.labels.has(IN));
});

test('Limit pro Lauf: Rest folgt im nächsten Lauf', () => {
  const before = w.sent.length;
  for (let i = 0; i < 3; i++) {
    const t = w.addThread([IN]);
    w.addMessage(t, { from: 'e-invoice@datev.de', subject: 'Limit ' + i, date: now(), attachments: [pdf('l' + i + '.pdf', UG_TEXT)] });
  }
  w.run({ MAX_MESSAGES_PER_RUN: 2 });
  assert.strictEqual(w.sent.length, before + 2);
  w.run();
  assert.strictEqual(w.sent.length, before + 3);
  w.ctx.MAX_MESSAGES_PER_RUN = 50;
});

test('Speicher: viele Einträge werden auf mehrere Properties verteilt und korrekt gelesen', () => {
  const s = w.ctx.Store_.load();
  for (let i = 0; i < 2000; i++) s.setMsg('x' + i.toString(16).padStart(15, '0'), 's');
  s.save();
  assert.ok(w.props.MSG_3, 'kein Sharding');
  const s2 = w.ctx.Store_.load();
  assert.strictEqual(s2.getMsgStatus('x' + (1999).toString(16).padStart(15, '0')), 's');
  assert.strictEqual(s2.getMsgStatus(mUG.id), 's');
});

test('Erkennungsmuster', () => {
  const c = w.ctx.classifyRecipient_;
  assert.strictEqual(c('1m4 ug (HAFTUNGSBESCHRÄNKT)').type, 'UG');
  assert.strictEqual(c('1M4 UG\nStrandweg 16').type, 'UG');
  assert.strictEqual(c('1M4 OÜ Järvevana tee 9 und 1M4 UG').type, 'UG');
  assert.strictEqual(c('Kunde: CHREP.me GmbH').type, 'OTHER');
  assert.strictEqual(c('VAT: EE102345678').type, 'OTHER');
  assert.strictEqual(c('IBAN EE38 2200 2210 2014 5685').type, 'UNKNOWN');
  assert.strictEqual(c('Strandweg 16, 17213 Göhren-Lebbin').type, 'UNKNOWN');
  assert.strictEqual(c('1M4 Outlet').type, 'UNKNOWN');
});

console.log(failures ? '\n' + failures + ' Test(s) fehlgeschlagen' : '\nAlle Tests bestanden');
process.exit(failures ? 1 : 0);
