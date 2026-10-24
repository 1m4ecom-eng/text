/**
 * 1M4 Logistik-Portal – Web-App (eigenes Skriptprojekt, ausgeführt als zugreifender Nutzer).
 *
 * Script Properties:
 *   SPREADSHEET_ID  – ID der Tabelle "1M4 Inventory" (bzw. der TEST-Kopie)
 *   VIEW_EMAILS     – nur Bestand + Buchungslog
 *   BOOK_EMAILS     – zusätzlich Buchen (ALLOWED_EMAILS aus Phase 2 zählt ebenfalls als BOOK)
 *   ADMIN_EMAILS    – zusätzlich Backend-Links
 *   ADMIN_LINKS     – Links "Bezeichnung | https://…", getrennt durch ";" oder Zeilenumbruch
 *
 * Schreibt nur Eingabespalten. Neue Zeilen in Sales/Purchases/Correction werden vor Zeile 7
 * eingefügt; Formeln, Format und Datenvalidierung kommen aus der Zeile darunter.
 * LOTs: erste freie Zeile mit vorhandenen Formeln. Spalten immer über die Kopfzeile (Zeile 5).
 */

var LB_CFG = {
  headerRow: 5,
  firstDataRow: 7,        // Sales, Purchases, Correction (Zeile 6 = ausgeblendete Vorlage)
  lotFirstRow: 6,
  sheets: { sales: 'Sales', purch: 'Purchases', corr: 'Correction', lots: 'LOTs', inv: 'Inventory', setup: 'Setup', vendors: 'Vendors', log: 'Buchungslog', stock: 'Bestand je Lager' },
  shippedCell: 'G11',     // Setup: Sales-Status "Shipped" (wie LotTracking.gs und Inventory-Formel)
  receivedStatus: '✅ Received', // wörtlich in der Inventory-Formel "Stock On Hand"
  warnDaysCell: 'M3',     // LOTs: "Warnung vor Ablauf (Tage)"
  blocked: 'Gesperrt',
  newLotLock: 'Gesperrt', // neue LOTs bis zur Freigabe gesperrt
  lagerHeader: 'Lager',
  lotRequiredHeader: 'LOT-Pflicht',
  transferPlus: '🔁 Umlagerung (+)',
  transferMinus: '🔁 Umlagerung (−)',
  logLimit: 50,
  logHeader: ['Zeitstempel', 'Buchungs-ID', 'Mitarbeiter', 'Google-Konto', 'Art', 'SKU', 'Artikel', 'Menge', 'LOT', 'LS-Nr.', 'Zieltab', 'Zeile', 'Hinweise', 'Lager']
};

var LB_LEVEL = { view: 1, book: 2, admin: 3 };

/* ------------------------------------------------------------------ */
/* Zugriff und Rollen                                                  */
/* ------------------------------------------------------------------ */

function LB_userEmail() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function LB_list(prop) {
  return String(PropertiesService.getScriptProperties().getProperty(prop) || '')
    .toLowerCase().split(/[\s,;]+/).filter(String);
}

/** 'admin' | 'book' | 'view' | null */
function LB_roleOf(email) {
  if (!email) return null;
  if (LB_list('ADMIN_EMAILS').indexOf(email) !== -1) return 'admin';
  if (LB_list('BOOK_EMAILS').concat(LB_list('ALLOWED_EMAILS')).indexOf(email) !== -1) return 'book';
  if (LB_list('VIEW_EMAILS').indexOf(email) !== -1) return 'view';
  return null;
}

function LB_require(level) {
  var email = LB_userEmail(), role = LB_roleOf(email);
  if (!role) throw new Error('Kein Zugriff für ' + (email || 'unbekanntes Konto') + '.');
  if (LB_LEVEL[role] < LB_LEVEL[level]) throw new Error('Keine Berechtigung für diese Funktion (Rolle: ' + role + ').');
  return { email: email, role: role };
}

function LB_adminLinks() {
  return String(PropertiesService.getScriptProperties().getProperty('ADMIN_LINKS') || '').split(/\r?\n|;/)
    .map(function (line) { var p = line.split('|'); return { label: LB_norm(p[0]), url: LB_norm(p.slice(1).join('|')) }; })
    .filter(function (l) { return l.label && /^https:\/\//.test(l.url); });
}

function LB_ss() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Skripteigenschaft SPREADSHEET_ID fehlt.');
  return SpreadsheetApp.openById(id);
}

function doGet() {
  var email = LB_userEmail();
  if (!LB_roleOf(email)) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Kein Zugriff für ' +
      (email ? email.replace(/[<>&"]/g, '') : 'unbekanntes Konto') + '.</p>').setTitle('1M4 Logistik');
  }
  return HtmlService.createTemplateFromFile('Logistik_Form').evaluate()
    .setTitle('1M4 Logistik-Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */

function LB_sheet(ss, key) {
  var sh = ss.getSheetByName(LB_CFG.sheets[key]);
  if (!sh) throw new Error('Tab "' + LB_CFG.sheets[key] + '" nicht gefunden.');
  return sh;
}

function LB_headerMap(sh) {
  var h = sh.getRange(LB_CFG.headerRow, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  h.forEach(function (v, i) { var k = LB_norm(v); if (k && !map[k]) map[k] = i + 1; });
  return map;
}

function LB_col(map, name, sheetName) {
  if (!map[name]) throw new Error('Spalte "' + name + '" in "' + sheetName + '" (Zeile ' + LB_CFG.headerRow + ') nicht gefunden.');
  return map[name];
}

function LB_asDate(v) {
  return (v instanceof Date && !isNaN(v)) ? v : null;
}

/** Listen unterhalb von Überschriften im Tab Setup (ein Lesezugriff). */
function LB_setup(ss) {
  var sh = LB_sheet(ss, 'setup');
  var vals = sh.getRange(1, 1, Math.min(sh.getMaxRows(), 120), sh.getLastColumn()).getValues();
  function list(header, withNext) {
    for (var r = 0; r < Math.min(vals.length, 60); r++) {
      for (var c = 0; c < vals[r].length; c++) {
        if (LB_norm(vals[r][c]) !== header) continue;
        var out = [], blanks = 0;
        for (var i = r + 1; i < vals.length && blanks < 2; i++) {
          var v = vals[i][c];
          if (LB_norm(v) === '') { if (out.length) blanks++; continue; }
          blanks = 0;
          out.push(withNext ? { name: String(v), sign: Number(vals[i][c + 1]) } : LB_norm(v));
        }
        return out;
      }
    }
    throw new Error('Überschrift "' + header + '" im Tab Setup nicht gefunden.');
  }
  var types = list('Correction Type', true).filter(function (t) { return t.sign === 1 || t.sign === -1; });
  var find = function (n) { for (var i = 0; i < types.length; i++) if (LB_norm(types[i].name) === n) return types[i].name; return null; };
  return {
    members: list('Team Member', false),
    lagers: list('Warehouse', false),
    corrTypes: types.filter(function (t) { return LB_norm(t.name).indexOf('Umlagerung') === -1; }),
    transferPlus: find(LB_CFG.transferPlus),
    transferMinus: find(LB_CFG.transferMinus),
    shipped: LB_norm(sh.getRange(LB_CFG.shippedCell).getValue())
  };
}

function LB_vendors(ss) {
  var sh = LB_sheet(ss, 'vendors');
  var n = sh.getLastRow() - 5;
  if (n <= 0) return [];
  return sh.getRange(6, 2, n, 1).getValues().map(function (r) { return LB_norm(r[0]); }).filter(String);
}

/** Artikelliste aus Inventory – ohne Preise, Kosten und Margen. */
function LB_items(ss) {
  var sh = LB_sheet(ss, 'inv'), map = LB_headerMap(sh), name = sh.getName();
  var cItem = LB_col(map, 'Item', name), cSku = LB_col(map, 'SKU', name), cEan = LB_col(map, 'EAN', name);
  var cStock = LB_col(map, 'Stock On Hand', name), cVendor = map['Preferred Vendor'], cReq = map[LB_CFG.lotRequiredHeader];
  var cType = map['Type'], cWh = map['Warehouse'];
  var n = sh.getLastRow() - LB_CFG.firstDataRow + 1;
  if (n <= 0) return [];
  var width = Math.max(cItem, cSku, cEan, cStock, cVendor || 1, cReq || 1, cType || 1, cWh || 1);
  var rng = sh.getRange(LB_CFG.firstDataRow, 1, n, width);
  var vals = rng.getValues(), disp = rng.getDisplayValues();
  var out = [];
  vals.forEach(function (r, i) {
    var item = LB_norm(r[cItem - 1]);
    if (!item) return;
    var ean = LB_norm(disp[i][cEan - 1]);
    out.push({
      item: item,
      sku: LB_norm(disp[i][cSku - 1]),
      ean: /^\d{8,14}$/.test(ean) ? ean : '',
      vendor: cVendor ? LB_norm(r[cVendor - 1]) : '',
      type: cType ? LB_norm(r[cType - 1]) : '',
      warehouse: cWh ? LB_norm(r[cWh - 1]) : '',
      stock: typeof r[cStock - 1] === 'number' ? r[cStock - 1] : null,
      lotRequired: cReq ? LB_norm(r[cReq - 1]).toLowerCase() !== 'nein' : true
    });
  });
  return out;
}

function LB_findItem(items, item) {
  var key = LB_norm(item);
  for (var i = 0; i < items.length; i++) if (items[i].item === key) return items[i];
  return null;
}

/** Alle LOTs (Restbestand aus den Formeln), optional nur ein Artikel. */
function LB_allLots(ss, item) {
  SpreadsheetApp.flush();
  var sh = LB_sheet(ss, 'lots'), map = LB_headerMap(sh), name = sh.getName();
  var c = {
    item: LB_col(map, 'Item', name), lot: LB_col(map, 'LOT', name), expiry: LB_col(map, 'Verfallsdatum', name),
    received: LB_col(map, 'Eingangsdatum', name), lock: LB_col(map, 'Sperre', name), rest: LB_col(map, 'Restbestand', name),
    status: LB_col(map, 'Status', name), lager: LB_col(map, LB_CFG.lagerHeader, name)
  };
  var n = sh.getLastRow() - LB_CFG.lotFirstRow + 1;
  if (n <= 0) return [];
  var width = Math.max(c.item, c.lot, c.expiry, c.received, c.lock, c.rest, c.status, c.lager);
  var rng = sh.getRange(LB_CFG.lotFirstRow, 1, n, width), vals = rng.getValues(), disp = rng.getDisplayValues();
  var key = item ? LB_norm(item) : null, out = [];
  vals.forEach(function (r, i) {
    var it = LB_norm(r[c.item - 1]);
    if (!it || !LB_norm(disp[i][c.lot - 1]) || (key && it !== key)) return;
    out.push({
      item: it,
      lot: LB_norm(disp[i][c.lot - 1]),
      lager: LB_norm(r[c.lager - 1]),
      rest: Number(r[c.rest - 1]) || 0,
      expiry: LB_asDate(r[c.expiry - 1]),
      received: LB_asDate(r[c.received - 1]),
      lock: LB_norm(r[c.lock - 1]),
      blocked: LB_norm(r[c.lock - 1]) === LB_CFG.blocked,
      status: LB_norm(r[c.status - 1]),
      row: LB_CFG.lotFirstRow + i
    });
  });
  return out;
}

/** Bestand je Lager aus dem Formel-Tab "Bestand je Lager": {item: {byLager: {}, total}} */
function LB_stockByLager(ss, lagers) {
  var sh = ss.getSheetByName(LB_CFG.sheets.stock);
  if (!sh) throw new Error('Tab "' + LB_CFG.sheets.stock + '" fehlt – bitte LAGER_setup im Sheetify-Projekt ausführen.');
  var map = LB_headerMap(sh), cItem = LB_col(map, 'Item', sh.getName()), cTot = LB_col(map, 'Gesamt', sh.getName());
  var n = sh.getLastRow() - LB_CFG.headerRow;
  var out = {};
  if (n <= 0) return out;
  var vals = sh.getRange(LB_CFG.headerRow + 1, 1, n, sh.getLastColumn()).getValues();
  vals.forEach(function (r) {
    var it = LB_norm(r[cItem - 1]);
    if (!it) return;
    var by = {};
    lagers.forEach(function (l) { by[l] = map[l] ? (Number(r[map[l] - 1]) || 0) : 0; });
    out[it] = { byLager: by, total: Number(r[cTot - 1]) || 0 };
  });
  return out;
}

function LB_fmtDate(d) {
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy') : '';
}

function LB_lotsForClient(lots, today, warnDays) {
  return LB_fefoSort(lots).map(function (l) {
    return { lot: l.lot, lager: l.lager, rest: l.rest, expiry: LB_fmtDate(l.expiry), status: l.status,
      state: LB_lotState(l, today, warnDays), selectable: LB_isSelectable(l, today) };
  });
}

function LB_warnDays(ss) {
  var v = Number(LB_sheet(ss, 'lots').getRange(LB_CFG.warnDaysCell).getValue());
  return v > 0 ? v : 90;
}

function LB_today() {
  var t = new Date(); t.setHours(0, 0, 0, 0); return t;
}

/** Daten für den Portalstart. */
function getInitData() {
  var u = LB_require('view'), ss = LB_ss(), st = LB_setup(ss);
  var book = LB_LEVEL[u.role] >= LB_LEVEL.book;
  return {
    email: u.email,
    role: u.role,
    lagers: st.lagers,
    members: book ? st.members : [],
    items: LB_items(ss).map(function (i) { return { item: i.item, sku: i.sku, ean: i.ean, vendor: book ? i.vendor : '', lotRequired: i.lotRequired }; }),
    vendors: book ? LB_vendors(ss) : [],
    types: book ? st.corrTypes.map(function (t) { return { name: t.name, label: t.sign > 0 ? 'Korrektur (+) Zugang' : 'Korrektur (−) Abgang' }; }) : [],
    transferReady: !!(st.transferPlus && st.transferMinus),
    links: u.role === 'admin' ? LB_adminLinks() : []
  };
}

/** Bestandsansicht: alle Artikel mit Bestand je Lager und LOTs (ohne Preise). */
function getStockOverview() {
  LB_require('view');
  var ss = LB_ss(), st = LB_setup(ss), today = LB_today(), warn = LB_warnDays(ss);
  var stock = LB_stockByLager(ss, st.lagers), lots = LB_allLots(ss);
  var lotsBy = {};
  lots.forEach(function (l) {
    if (l.rest === 0) return;
    (lotsBy[l.item] = lotsBy[l.item] || []).push(l);
  });
  return {
    lagers: st.lagers, warnDays: warn,
    stand: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm'),
    items: LB_items(ss).map(function (i) {
      var s = stock[i.item] || { byLager: {}, total: 0 };
      return { item: i.item, sku: i.sku, ean: i.ean, type: i.type, byLager: s.byLager, total: s.total,
        lots: LB_lotsForClient(lotsBy[i.item] || [], today, warn) };
    })
  };
}

/** Buchungslog: die letzten Einträge, neueste zuerst. */
function getLog() {
  LB_require('view');
  var sh = LB_ss().getSheetByName(LB_CFG.sheets.log);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(LB_CFG.logLimit, sh.getLastRow() - 1), start = sh.getLastRow() - n + 1;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(LB_norm);
  var vals = sh.getRange(start, 1, n, head.length).getValues();
  var ix = function (h) { return head.indexOf(h); };
  return vals.reverse().map(function (r) {
    var get = function (h) { var i = ix(h); return i === -1 ? '' : r[i]; };
    var ts = get('Zeitstempel');
    return {
      ts: ts instanceof Date ? Utilities.formatDate(ts, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm') : String(ts),
      id: String(get('Buchungs-ID')), member: String(get('Mitarbeiter')), kind: String(get('Art')), sku: String(get('SKU')),
      item: String(get('Artikel')), qty: String(get('Menge')), lot: String(get('LOT')), lsNo: String(get('LS-Nr.')),
      lager: String(get('Lager')), note: String(get('Hinweise'))
    };
  });
}

/** Aktueller Bestand und LOTs eines Artikels in einem Lager (für die Buchungsformulare). */
function getItemDetails(item, lager) {
  LB_require('book');
  var ss = LB_ss(), st = LB_setup(ss), it = LB_findItem(LB_items(ss), item);
  if (!it) throw new Error('Artikel nicht gefunden.');
  var today = LB_today(), warn = LB_warnDays(ss);
  var stock = LB_stockByLager(ss, st.lagers)[it.item] || { byLager: {}, total: it.stock };
  var lots = LB_byLager(LB_allLots(ss, it.item), lager);
  return { item: it.item, sku: it.sku, lager: LB_norm(lager), stock: stock.byLager[LB_norm(lager)] || 0, total: stock.total,
    lotRequired: it.lotRequired, lots: LB_lotsForClient(lots, today, warn) };
}

/* ------------------------------------------------------------------ */
/* Schreiben                                                           */
/* ------------------------------------------------------------------ */

/** Gemeinsamer Kontext einer Buchung (jeder Bereich wird nur einmal gelesen). */
function LB_ctx(ss, itemName, lager) {
  var st = LB_setup(ss), items = LB_items(ss), it = LB_findItem(items, itemName);
  var all = it ? LB_allLots(ss, it.item) : [];
  var stock = it ? (LB_stockByLager(ss, st.lagers)[it.item] || null) : null;
  var lagerStock = function (l) { return stock ? (stock.byLager[LB_norm(l)] || 0) : null; };
  return { st: st, it: it, allLots: all, lots: LB_byLager(all, lager), lagerStock: lagerStock, today: LB_today() };
}

function LB_parseDate(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Fügt vor Zeile 7 eine Zeile ein und übernimmt Formeln/Format/Validierung aus der Zeile darunter. */
function LB_insertTopRow(sh) {
  var r = LB_CFG.firstDataRow, width = sh.getMaxColumns();
  sh.insertRowBefore(r);
  var src = sh.getRange(r + 1, 1, 1, width), dst = sh.getRange(r, 1, 1, width);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  var f = src.getFormulasR1C1()[0];
  for (var i = 0; i < f.length; i++) if (f[i]) sh.getRange(r, i + 1).setFormulaR1C1(f[i]);
  if (sh.isRowHiddenByUser(r)) sh.showRows(r);
  return r;
}

/**
 * Schreibt nur in Zellen ohne Formel; Spalten über Kopfzeilen-Namen.
 * Benachbarte Spalten werden in einem Schreibzugriff zusammengefasst.
 */
function LB_writeInputs(sh, row, values) {
  var map = LB_headerMap(sh), cols = {};
  Object.keys(values).forEach(function (h) { cols[LB_col(map, h, sh.getName())] = values[h]; });
  var keys = Object.keys(cols).map(Number).sort(function (a, b) { return a - b; });
  var first = keys[0], last = keys[keys.length - 1];
  var formulas = sh.getRange(row, first, 1, last - first + 1).getFormulas()[0];
  keys.forEach(function (c) {
    if (formulas[c - first]) throw new Error('Spalte in "' + sh.getName() + '" (Spalte ' + c + ') enthält eine Formel – Abbruch.');
  });
  var run = [];
  var flush = function () {
    if (!run.length) return;
    sh.getRange(row, run[0], 1, run.length).setValues([run.map(function (c) { return cols[c]; })]);
    run = [];
  };
  keys.forEach(function (c) { if (run.length && c !== run[run.length - 1] + 1) flush(); run.push(c); });
  flush();
}

/** Erste freie LOTs-Zeile (Item und LOT leer, Formeln vorhanden). */
function LB_freeLotRow(sh) {
  var map = LB_headerMap(sh), cItem = LB_col(map, 'Item', 'LOTs'), cLot = LB_col(map, 'LOT', 'LOTs'), cRest = LB_col(map, 'Restbestand', 'LOTs');
  var n = sh.getMaxRows() - LB_CFG.lotFirstRow + 1;
  var vals = sh.getRange(LB_CFG.lotFirstRow, 1, n, Math.max(cItem, cLot)).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (!LB_norm(vals[i][cItem - 1]) && !LB_norm(vals[i][cLot - 1])) {
      var row = LB_CFG.lotFirstRow + i;
      if (!sh.getRange(row, cRest).getFormula()) throw new Error('Tab "LOTs": Zeile ' + row + ' hat keine Formeln – bitte Formelzeilen nach unten erweitern.');
      return row;
    }
  }
  throw new Error('Tab "LOTs" ist voll – bitte Zeilen (inkl. Formeln) nach unten erweitern.');
}

function LB_bookingId() {
  return 'B' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
}

function LB_log(ss, rec) {
  var sh = ss.getSheetByName(LB_CFG.sheets.log), h = LB_CFG.logHeader;
  if (!sh) {
    sh = ss.insertSheet(LB_CFG.sheets.log);
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (!LB_norm(sh.getRange(1, h.length).getValue())) {
    sh.getRange(1, h.length).setValue(h[h.length - 1]).setFontWeight('bold');
  }
  sh.appendRow([new Date(), rec.id, rec.member, rec.email, rec.kind, rec.sku, rec.item, rec.qty, rec.lot || '', rec.lsNo || '', rec.sheet, rec.row, rec.note || '', rec.lager || '']);
}

function LB_withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Eine andere Buchung läuft gerade. Bitte in ein paar Sekunden erneut versuchen.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function LB_result(v, extra) {
  var r = { errors: v.errors, warnings: v.warnings, needsConfirm: !v.errors.length && v.warnings.length > 0 };
  Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

function LB_joinNotes(list) {
  return list.map(LB_norm).filter(String).join(' · ');
}

/** A) Wareneingang: LOT im Lager anlegen (bzw. bestehende LOT aufstocken), dann Purchases buchen. */
function bookReceipt(input) {
  var u = LB_require('book');
  return LB_withLock(function () {
    var ss = LB_ss(), lager = LB_norm(input.lager), x = LB_ctx(ss, input.item, lager), it = x.it;
    var data = { member: input.member, lager: lager, qty: Number(input.qty), lot: input.lot, expiry: LB_parseDate(input.expiry), vendor: input.vendor, ref: input.ref, notes: input.notes };
    var v = LB_validateReceipt(data, { members: x.st.members, lagers: x.st.lagers, item: it, lots: x.lots, today: x.today });
    if (v.errors.length || (v.warnings.length && !input.confirm)) return LB_result(v);

    var id = LB_bookingId(), lot = LB_norm(data.lot), lotRow = '';
    var lsh = LB_sheet(ss, 'lots');
    if (lot) {
      if (v.existingLot) {
        lotRow = v.existingLot.row;
        var lmap = LB_headerMap(lsh), cQty = LB_col(lmap, 'Menge Eingang', 'LOTs'), cSrc = LB_col(lmap, 'Quelle / Referenz', 'LOTs');
        var oldQty = Number(lsh.getRange(lotRow, cQty).getValue()) || 0;
        var oldSrc = LB_norm(lsh.getRange(lotRow, cSrc).getValue());
        LB_writeInputs(lsh, lotRow, {
          'Menge Eingang': oldQty + data.qty,
          'Quelle / Referenz': LB_joinNotes([oldSrc, '+' + data.qty + ' am ' + LB_fmtDate(x.today) + ' ' + LB_joinNotes([data.ref]) + ' [' + id + ']'])
        });
      } else {
        lotRow = LB_freeLotRow(lsh);
        LB_writeInputs(lsh, lotRow, {
          'Eingangsdatum': x.today,
          'Item': it.item,
          'LOT': lot,
          'Verfallsdatum': data.expiry || '',
          'Menge Eingang': data.qty,
          'Quelle / Referenz': LB_joinNotes([data.ref, 'Formular [' + id + ']']),
          'Sperre': LB_CFG.newLotLock,
          'Notizen': LB_norm(data.notes),
          'Lager': lager
        });
      }
    }

    var psh = LB_sheet(ss, 'purch'), prow = LB_insertTopRow(psh);
    LB_writeInputs(psh, prow, {
      'Order Date': x.today,
      'Created By': LB_norm(data.member),
      'Recieved Date': x.today,
      'Item': it.item,
      'Purchase QTY': data.qty,
      'Recieved QTY': data.qty,
      'Status': LB_CFG.receivedStatus,
      'Vendor': LB_norm(data.vendor),
      'Notes': LB_joinNotes([data.ref ? 'Ref: ' + data.ref : '', lot ? 'LOT ' + lot : '', data.notes, '[' + id + ']']),
      'Lager': lager
    });
    LB_log(ss, { id: id, member: data.member, email: u.email, kind: 'Wareneingang', sku: it.sku, item: it.item, qty: data.qty, lot: lot, sheet: 'Purchases / LOTs', row: prow + (lotRow ? ' / ' + lotRow : ''), note: v.existingLot ? 'bestehende LOT aufgestockt' : (lot ? 'neue LOT (' + LB_CFG.newLotLock + ')' : 'ohne LOT'), lager: lager });
    return LB_result({ errors: [], warnings: [] }, {
      ok: true, id: id,
      summary: ['Wareneingang gebucht (' + id + ')', it.item + ' (SKU ' + it.sku + ')', 'Lager: ' + lager, 'Menge: ' + data.qty,
        lot ? 'LOT: ' + lot + (v.existingLot ? ' (bestehende LOT aufgestockt, Zeile ' + lotRow + ')' : ' (neu, Zeile ' + lotRow + ', Sperre: ' + LB_CFG.newLotLock + ')') : 'ohne LOT',
        'Purchases: Zeile ' + prow]
    });
  });
}

function LB_shipmentInput(input) {
  return { member: input.member, lager: LB_norm(input.lager), lsNo: input.lsNo, qty: Number(input.qty), parts: input.parts || null, notes: input.notes };
}

function LB_shipmentCtx(x) {
  return { members: x.st.members, lagers: x.st.lagers, item: x.it ? { lotRequired: x.it.lotRequired, stock: x.lagerStock(x.lagerName) } : null, lots: x.lots, today: x.today };
}

/** Vorschau Warenausgang (FEFO-Vorschlag aus dem gewählten Lager, Warnungen, ohne zu buchen). */
function previewShipment(input) {
  LB_require('book');
  var ss = LB_ss(), data = LB_shipmentInput(input), x = LB_ctx(ss, input.item, data.lager);
  x.lagerName = data.lager;
  if (!LB_norm(data.lsNo)) data.lsNo = '-';
  var v = LB_validateShipment(data, LB_shipmentCtx(x));
  return { errors: v.errors, warnings: v.warnings, parts: v.parts, missing: v.missing, lotText: v.lotText, suggestion: v.suggestion };
}

/** B) Warenausgang in Sales (Status "Shipped", LOT-Text wie LotTracking.gs). */
function bookShipment(input) {
  var u = LB_require('book');
  return LB_withLock(function () {
    var ss = LB_ss(), data = LB_shipmentInput(input), x = LB_ctx(ss, input.item, data.lager), it = x.it;
    x.lagerName = data.lager;
    var v = LB_validateShipment(data, LB_shipmentCtx(x));
    if (v.errors.length || (v.warnings.length && !input.confirm)) return LB_result(v, { lotText: v.lotText });
    if (!x.st.shipped) throw new Error('Sales-Status "Shipped" in Setup!' + LB_CFG.shippedCell + ' fehlt.');

    var id = LB_bookingId(), sh = LB_sheet(ss, 'sales'), row = LB_insertTopRow(sh);
    LB_writeInputs(sh, row, {
      'Order Date': x.today,
      'Created By': LB_norm(data.member),
      'LS No.': LB_norm(data.lsNo),
      'Item': it.item,
      'QTY': data.qty,
      'Status': x.st.shipped,
      'Notes': LB_joinNotes([data.notes, '[' + id + ']']),
      'LOT': v.lotText,
      'Lager': data.lager
    });
    LB_log(ss, { id: id, member: data.member, email: u.email, kind: 'Warenausgang', sku: it.sku, item: it.item, qty: data.qty, lot: v.lotText, lsNo: LB_norm(data.lsNo), sheet: 'Sales', row: row, note: v.warnings.join(' | '), lager: data.lager });
    return LB_result({ errors: [], warnings: [] }, {
      ok: true, id: id,
      summary: ['Warenausgang gebucht (' + id + ')', it.item + ' (SKU ' + it.sku + ')', 'Lager: ' + data.lager, 'Menge: ' + data.qty, 'LS-Nr.: ' + LB_norm(data.lsNo),
        'LOT: ' + (v.lotText || '–'), 'Sales: Zeile ' + row + ', Status ' + x.st.shipped]
    });
  });
}

/** C) Korrektur in Correction. */
function bookCorrection(input) {
  var u = LB_require('book');
  return LB_withLock(function () {
    var ss = LB_ss(), lager = LB_norm(input.lager), x = LB_ctx(ss, input.item, lager), it = x.it;
    var data = { member: input.member, lager: lager, type: input.type, qty: Number(input.qty), lot: input.lot, notes: input.notes };
    var v = LB_validateCorrection(data, { members: x.st.members, lagers: x.st.lagers, types: x.st.corrTypes,
      item: it ? { stock: x.lagerStock(lager) } : null, lots: x.lots, today: x.today });
    if (v.errors.length || (v.warnings.length && !input.confirm)) return LB_result(v);

    var id = LB_bookingId(), sh = LB_sheet(ss, 'corr'), row = LB_insertTopRow(sh);
    LB_writeInputs(sh, row, {
      'Date': x.today,
      'Created By': LB_norm(data.member),
      'Item': it.item,
      'Quantity': data.qty,
      'Type': v.typeName,   // Rohwert aus Setup (inkl. führender Leerzeichen)
      'Notes': LB_joinNotes([data.notes, '[' + id + ']']),
      'LOT': v.lot ? v.lot.lot : '',
      'Lager': lager
    });
    LB_log(ss, { id: id, member: data.member, email: u.email, kind: 'Korrektur ' + (v.sign > 0 ? '(+)' : '(−)'), sku: it.sku, item: it.item, qty: data.qty, lot: v.lot ? v.lot.lot : '', sheet: 'Correction', row: row, note: LB_norm(data.notes), lager: lager });
    return LB_result({ errors: [], warnings: [] }, {
      ok: true, id: id,
      summary: ['Korrektur gebucht (' + id + ')', it.item + ' (SKU ' + it.sku + ')', 'Lager: ' + lager, (v.sign > 0 ? 'Zugang +' : 'Abgang −') + data.qty,
        'LOT: ' + (v.lot ? v.lot.lot : '–'), 'Correction: Zeile ' + row]
    });
  });
}

function LB_transferInput(input) {
  return { member: input.member, from: LB_norm(input.from), to: LB_norm(input.to), qty: Number(input.qty), parts: input.parts || null, lsNo: input.lsNo, notes: input.notes };
}

function LB_transferCtx(x, from) {
  return { members: x.st.members, lagers: x.st.lagers, item: x.it ? { lotRequired: x.it.lotRequired, stock: x.lagerStock(from) } : null, lots: x.lots, today: x.today };
}

/** Vorschau Umlagerung (FEFO-Vorschlag aus dem Quelllager). */
function previewTransfer(input) {
  LB_require('book');
  var ss = LB_ss(), data = LB_transferInput(input), x = LB_ctx(ss, input.item, data.from);
  var v = LB_validateTransfer(data, LB_transferCtx(x, data.from));
  return { errors: v.errors, warnings: v.warnings, parts: v.parts, missing: v.missing, suggestion: v.suggestion };
}

/**
 * D) Umlagerung: je LOT-Anteil eine Correction-Zeile "Umlagerung (−)" im Quelllager und
 * "Umlagerung (+)" im Ziellager (gleiche Buchungs-ID). Fehlt die LOT im Ziellager, wird dort eine
 * LOT-Zeile mit Menge Eingang 0, gleichem Verfall und gleicher Sperre angelegt.
 */
function bookTransfer(input) {
  var u = LB_require('book');
  return LB_withLock(function () {
    var ss = LB_ss(), data = LB_transferInput(input), x = LB_ctx(ss, input.item, data.from), it = x.it;
    if (!x.st.transferPlus || !x.st.transferMinus) throw new Error('Korrekturtypen für Umlagerung fehlen in Setup – bitte LAGER_setup ausführen.');
    var v = LB_validateTransfer(data, LB_transferCtx(x, data.from));
    if (v.errors.length || (v.warnings.length && !input.confirm)) return LB_result(v);

    var id = LB_bookingId(), lsh = LB_sheet(ss, 'lots'), targetLots = LB_byLager(x.allLots, data.to), created = [];
    v.parts.forEach(function (p) {
      if (LB_findLot(targetLots, p.lot)) return;
      var src = LB_findLot(x.lots, p.lot), row = LB_freeLotRow(lsh);
      LB_writeInputs(lsh, row, {
        'Eingangsdatum': src.received || x.today,
        'Item': it.item,
        'LOT': p.lot,
        'Verfallsdatum': src.expiry || '',
        'Menge Eingang': 0,
        'Quelle / Referenz': 'Umlagerung aus ' + data.from + ' [' + id + ']',
        'Sperre': src.lock,
        'Notizen': '',
        'Lager': data.to
      });
      targetLots.push({ lot: p.lot, lager: data.to, row: row });
      created.push(p.lot + ' (Zeile ' + row + ')');
    });

    var sh = LB_sheet(ss, 'corr'), rows = [];
    var chunks = v.parts.map(function (p) { return { lot: p.lot, qty: p.qty }; });
    if (v.missing > 0) chunks.push({ lot: '', qty: v.missing });
    var note = LB_joinNotes([data.lsNo ? 'LS ' + data.lsNo : '', data.notes, data.from + ' → ' + data.to, '[' + id + ']']);
    chunks.forEach(function (c) {
      [[x.st.transferMinus, data.from], [x.st.transferPlus, data.to]].forEach(function (t) {
        var row = LB_insertTopRow(sh);
        LB_writeInputs(sh, row, {
          'Date': x.today, 'Created By': LB_norm(data.member), 'Item': it.item, 'Quantity': c.qty,
          'Type': t[0], 'Notes': note, 'LOT': c.lot, 'Lager': t[1]
        });
        rows.push(row);
      });
    });
    var lotText = LB_formatLotText(v.parts, v.missing).replace(LB_NONE, 'ohne LOT');
    LB_log(ss, { id: id, member: data.member, email: u.email, kind: 'Umlagerung', sku: it.sku, item: it.item, qty: data.qty, lot: lotText,
      lsNo: LB_norm(data.lsNo), sheet: 'Correction' + (created.length ? ' / LOTs' : ''), row: rows.length + ' Zeilen' + (created.length ? ' / neue LOT-Zeilen: ' + created.join(', ') : ''),
      note: v.warnings.join(' | '), lager: data.from + ' → ' + data.to });
    return LB_result({ errors: [], warnings: [] }, {
      ok: true, id: id,
      summary: ['Umlagerung gebucht (' + id + ')', it.item + ' (SKU ' + it.sku + ')', data.from + ' → ' + data.to, 'Menge: ' + data.qty,
        'LOT: ' + (lotText || '–'), 'Correction: ' + rows.length + ' Zeilen' + (created.length ? '; neue LOT-Zeilen im Ziellager: ' + created.join(', ') : '')]
    });
  });
}
