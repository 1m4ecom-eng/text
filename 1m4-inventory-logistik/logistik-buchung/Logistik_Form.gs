/**
 * 1M4 Logistik-Buchung – Web-App (eigenes Skriptprojekt, ausgeführt als zugreifender Nutzer).
 *
 * Script Properties (Projekteinstellungen → Skripteigenschaften):
 *   SPREADSHEET_ID  – ID der Tabelle "1M4 Inventory" (bzw. der TEST-Kopie)
 *   ALLOWED_EMAILS  – erlaubte Google-Konten, durch Komma getrennt
 *
 * Schreibt nur Eingabespalten. Neue Zeilen in Sales/Purchases/Correction werden wie bei
 * Sheetify vor Zeile 7 eingefügt; Formeln, Format und Datenvalidierung kommen aus der
 * bisherigen ersten Datenzeile (nicht aus der veralteten Vorlagezeile 6 bzw. den festen
 * Spaltennummern der Sheetify-Funktionen addSale/addPurchase).
 * LOTs: erste freie Zeile mit vorhandenen Formeln (wie LOT_offerReceipt).
 */

var LB_CFG = {
  headerRow: 5,
  firstDataRow: 7,        // Sales, Purchases, Correction (Zeile 6 = ausgeblendete Vorlage)
  lotFirstRow: 6,
  sheets: { sales: 'Sales', purch: 'Purchases', corr: 'Correction', lots: 'LOTs', inv: 'Inventory', setup: 'Setup', vendors: 'Vendors', log: 'Buchungslog' },
  shippedCell: 'G11',     // Setup: Sales-Status "Shipped" (wie LotTracking.gs und Inventory-Formel)
  receivedStatus: '✅ Received', // wörtlich in der Inventory-Formel "Stock On Hand"
  blocked: 'Gesperrt',
  newLotLock: 'Gesperrt', // neue LOTs bis zur Freigabe gesperrt
  lotRequiredHeader: 'LOT-Pflicht',
  logHeader: ['Zeitstempel', 'Buchungs-ID', 'Mitarbeiter', 'Google-Konto', 'Art', 'SKU', 'Artikel', 'Menge', 'LOT', 'LS-Nr.', 'Zieltab', 'Zeile', 'Hinweise']
};

/* ------------------------------------------------------------------ */
/* Zugriff                                                             */
/* ------------------------------------------------------------------ */

function LB_userEmail() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function LB_isAllowed(email) {
  var list = String(PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .toLowerCase().split(/[\s,;]+/).filter(String);
  return !!email && list.indexOf(email) !== -1;
}

function LB_requireUser() {
  var email = LB_userEmail();
  if (!LB_isAllowed(email)) throw new Error('Kein Zugriff für ' + (email || 'unbekanntes Konto') + '.');
  return email;
}

function LB_ss() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Skripteigenschaft SPREADSHEET_ID fehlt.');
  return SpreadsheetApp.openById(id);
}

function doGet() {
  var email = LB_userEmail();
  if (!LB_isAllowed(email)) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Kein Zugriff für ' +
      (email ? email.replace(/[<>&"]/g, '') : 'unbekanntes Konto') + '.</p>').setTitle('1M4 Logistik');
  }
  return HtmlService.createTemplateFromFile('Logistik_Form').evaluate()
    .setTitle('1M4 Logistik-Buchung')
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

/** Werte unterhalb einer Überschrift im Tab Setup (sucht die Überschrift in den ersten 60 Zeilen). */
function LB_setupList(ss, header, withNext) {
  var sh = LB_sheet(ss, 'setup');
  var vals = sh.getRange(1, 1, Math.min(sh.getMaxRows(), 120), sh.getLastColumn()).getValues();
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

function LB_members(ss) { return LB_setupList(ss, 'Team Member', false); }

function LB_correctionTypes(ss) {
  return LB_setupList(ss, 'Correction Type', true).filter(function (t) { return t.sign === 1 || t.sign === -1; });
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
  var n = sh.getLastRow() - LB_CFG.firstDataRow + 1;
  if (n <= 0) return [];
  var width = Math.max(cItem, cSku, cEan, cStock, cVendor || 1, cReq || 1);
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
      stock: typeof r[cStock - 1] === 'number' ? r[cStock - 1] : null,
      lotRequired: cReq ? LB_norm(r[cReq - 1]).toLowerCase() !== 'nein' : true
    });
  });
  return out;
}

function LB_findItem(ss, item) {
  var key = LB_norm(item), list = LB_items(ss);
  for (var i = 0; i < list.length; i++) if (list[i].item === key) return list[i];
  return null;
}

/** Alle LOTs eines Artikels (Restbestand aus den Formeln). */
function LB_lotsFor(ss, item) {
  SpreadsheetApp.flush();
  var sh = LB_sheet(ss, 'lots'), map = LB_headerMap(sh), name = sh.getName();
  var c = {
    item: LB_col(map, 'Item', name), lot: LB_col(map, 'LOT', name), expiry: LB_col(map, 'Verfallsdatum', name),
    received: LB_col(map, 'Eingangsdatum', name), lock: LB_col(map, 'Sperre', name), rest: LB_col(map, 'Restbestand', name),
    status: LB_col(map, 'Status', name)
  };
  var n = sh.getLastRow() - LB_CFG.lotFirstRow + 1;
  if (n <= 0) return [];
  var width = Math.max(c.item, c.lot, c.expiry, c.received, c.lock, c.rest, c.status);
  var rng = sh.getRange(LB_CFG.lotFirstRow, 1, n, width), vals = rng.getValues(), disp = rng.getDisplayValues();
  var key = LB_norm(item), out = [];
  vals.forEach(function (r, i) {
    if (LB_norm(r[c.item - 1]) !== key || !LB_norm(disp[i][c.lot - 1])) return;
    out.push({
      lot: LB_norm(disp[i][c.lot - 1]),
      rest: Number(r[c.rest - 1]) || 0,
      expiry: LB_asDate(r[c.expiry - 1]),
      received: LB_asDate(r[c.received - 1]),
      blocked: LB_norm(r[c.lock - 1]) === LB_CFG.blocked,
      status: LB_norm(r[c.status - 1]),
      row: LB_CFG.lotFirstRow + i
    });
  });
  return out;
}

function LB_fmtDate(d) {
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy') : '';
}

function LB_lotsForClient(lots, today) {
  return LB_fefoSort(lots).map(function (l) {
    return { lot: l.lot, rest: l.rest, expiry: LB_fmtDate(l.expiry), status: l.status, selectable: LB_isSelectable(l, today) };
  });
}

/** Daten für den Formularstart. */
function getInitData() {
  var email = LB_requireUser(), ss = LB_ss();
  return {
    email: email,
    members: LB_members(ss),
    items: LB_items(ss).map(function (i) { return { item: i.item, sku: i.sku, ean: i.ean, vendor: i.vendor, lotRequired: i.lotRequired }; }),
    vendors: LB_vendors(ss),
    types: LB_correctionTypes(ss).map(function (t) { return { name: t.name, label: t.sign > 0 ? 'Korrektur (+) Zugang' : 'Korrektur (−) Abgang' }; })
  };
}

/** Aktueller Bestand und LOTs eines Artikels. */
function getItemDetails(item) {
  LB_requireUser();
  var ss = LB_ss(), it = LB_findItem(ss, item);
  if (!it) throw new Error('Artikel nicht gefunden.');
  var today = new Date(), lots = LB_lotsFor(ss, it.item);
  return { item: it.item, sku: it.sku, stock: it.stock, lotRequired: it.lotRequired, lots: LB_lotsForClient(lots, today) };
}

/* ------------------------------------------------------------------ */
/* Schreiben                                                           */
/* ------------------------------------------------------------------ */

function LB_today() {
  var t = new Date(); t.setHours(0, 0, 0, 0); return t;
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

/** Schreibt nur in Zellen ohne Formel; Spalten über Kopfzeilen-Namen. */
function LB_writeInputs(sh, row, values) {
  var map = LB_headerMap(sh);
  Object.keys(values).forEach(function (h) {
    var cell = sh.getRange(row, LB_col(map, h, sh.getName()));
    if (cell.getFormula()) throw new Error('Spalte "' + h + '" in "' + sh.getName() + '" enthält eine Formel – Abbruch.');
    cell.setValue(values[h]);
  });
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
  var sh = ss.getSheetByName(LB_CFG.sheets.log);
  if (!sh) {
    sh = ss.insertSheet(LB_CFG.sheets.log);
    sh.getRange(1, 1, 1, LB_CFG.logHeader.length).setValues([LB_CFG.logHeader]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), rec.id, rec.member, rec.email, rec.kind, rec.sku, rec.item, rec.qty, rec.lot || '', rec.lsNo || '', rec.sheet, rec.row, rec.note || '']);
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

/** A) Wareneingang: LOT anlegen (bzw. bestehende LOT aufstocken), dann Purchases buchen. */
function bookReceipt(input) {
  var email = LB_requireUser();
  return LB_withLock(function () {
    var ss = LB_ss(), today = LB_today();
    var it = LB_findItem(ss, input.item);
    var data = { member: input.member, qty: Number(input.qty), lot: input.lot, expiry: LB_parseDate(input.expiry), vendor: input.vendor, ref: input.ref, notes: input.notes };
    var v = LB_validateReceipt(data, { members: LB_members(ss), item: it, lots: it ? LB_lotsFor(ss, it.item) : [], today: today });
    if (v.errors.length || (v.warnings.length && !input.confirm)) return LB_result(v);

    var id = LB_bookingId(), lot = LB_norm(data.lot), lotRow = '';
    var lsh = LB_sheet(ss, 'lots'), lmap = LB_headerMap(lsh);
    if (lot) {
      if (v.existingLot) {
        lotRow = v.existingLot.row;
        var cQty = LB_col(lmap, 'Menge Eingang', 'LOTs'), cSrc = LB_col(lmap, 'Quelle / Referenz', 'LOTs');
        var oldQty = Number(lsh.getRange(lotRow, cQty).getValue()) || 0;
        var oldSrc = LB_norm(lsh.getRange(lotRow, cSrc).getValue());
        LB_writeInputs(lsh, lotRow, {
          'Menge Eingang': oldQty + data.qty,
          'Quelle / Referenz': LB_joinNotes([oldSrc, '+' + data.qty + ' am ' + LB_fmtDate(today) + ' ' + LB_joinNotes([data.ref]) + ' [' + id + ']'])
        });
      } else {
        lotRow = LB_freeLotRow(lsh);
        LB_writeInputs(lsh, lotRow, {
          'Eingangsdatum': today,
          'Item': it.item,
          'LOT': lot,
          'Verfallsdatum': data.expiry || '',
          'Menge Eingang': data.qty,
          'Quelle / Referenz': LB_joinNotes([data.ref, 'Formular [' + id + ']']),
          'Sperre': LB_CFG.newLotLock,
          'Notizen': LB_norm(data.notes)
        });
      }
      SpreadsheetApp.flush();
    }

    var psh = LB_sheet(ss, 'purch'), prow = LB_insertTopRow(psh);
    LB_writeInputs(psh, prow, {
      'Order Date': today,
      'Created By': LB_norm(data.member),
      'Recieved Date': today,
      'Item': it.item,
      'Purchase QTY': data.qty,
      'Recieved QTY': data.qty,
      'Status': LB_CFG.receivedStatus,
      'Vendor': LB_norm(data.vendor),
      'Notes': LB_joinNotes([data.ref ? 'Ref: ' + data.ref : '', lot ? 'LOT ' + lot : '', data.notes, '[' + id + ']'])
    });
    LB_log(ss, { id: id, member: data.member, email: email, kind: 'Wareneingang', sku: it.sku, item: it.item, qty: data.qty, lot: lot, sheet: 'Purchases / LOTs', row: prow + (lotRow ? ' / ' + lotRow : ''), note: v.existingLot ? 'bestehende LOT aufgestockt' : (lot ? 'neue LOT (' + LB_CFG.newLotLock + ')' : 'ohne LOT') });
    SpreadsheetApp.flush();
    return LB_result({ errors: [], warnings: [] }, {
      ok: true, id: id,
      summary: ['Wareneingang gebucht (' + id + ')', it.item + ' (SKU ' + it.sku + ')', 'Menge: ' + data.qty,
        lot ? 'LOT: ' + lot + (v.existingLot ? ' (bestehende LOT aufgestockt, Zeile ' + lotRow + ')' : ' (neu, Zeile ' + lotRow + ', Sperre: ' + LB_CFG.newLotLock + ')') : 'ohne LOT',
        'Purchases: Zeile ' + prow]
    });
  });
}

/** Vorschau Warenausgang (FEFO-Vorschlag und Warnungen, ohne zu buchen). */
function previewShipment(input) {
  LB_requireUser();
  var ss = LB_ss(), it = LB_findItem(ss, input.item);
  var v = LB_validateShipment({ member: input.member, lsNo: input.lsNo, qty: Number(input.qty), parts: input.parts || null },
    { members: LB_members(ss), item: it, lots: it ? LB_lotsFor(ss, it.item) : [], today: LB_today() });
  return { errors: v.errors, warnings: v.warnings, parts: v.parts, missing: v.missing, lotText: v.lotText, suggestion: v.suggestion };
}

/** B) Warenausgang in Sales (Status "Shipped", LOT-Text wie LotTracking.gs). */
function bookShipment(input) {
  var email = LB_requireUser();
  return LB_withLock(function () {
    var ss = LB_ss(), it = LB_findItem(ss, input.item);
    var data = { member: input.member, lsNo: input.lsNo, qty: Number(input.qty), parts: input.parts || null, notes: input.notes };
    var v = LB_validateShipment(data, { members: LB_members(ss), item: it, lots: it ? LB_lotsFor(ss, it.item) : [], today: LB_today() });
    if (v.errors.length || (v.warnings.length && !input.confirm)) return LB_result(v, { lotText: v.lotText });

    var shipped = LB_norm(LB_sheet(ss, 'setup').getRange(LB_CFG.shippedCell).getValue());
    if (!shipped) throw new Error('Sales-Status "Shipped" in Setup!' + LB_CFG.shippedCell + ' fehlt.');
    var id = LB_bookingId(), sh = LB_sheet(ss, 'sales'), row = LB_insertTopRow(sh);
    LB_writeInputs(sh, row, {
      'Order Date': LB_today(),
      'Created By': LB_norm(data.member),
      'LS No.': LB_norm(data.lsNo),
      'Item': it.item,
      'QTY': data.qty,
      'Status': shipped,
      'Notes': LB_joinNotes([data.notes, '[' + id + ']']),
      'LOT': v.lotText
    });
    LB_log(ss, { id: id, member: data.member, email: email, kind: 'Warenausgang', sku: it.sku, item: it.item, qty: data.qty, lot: v.lotText, lsNo: LB_norm(data.lsNo), sheet: 'Sales', row: row, note: v.warnings.join(' | ') });
    SpreadsheetApp.flush();
    return LB_result({ errors: [], warnings: [] }, {
      ok: true, id: id,
      summary: ['Warenausgang gebucht (' + id + ')', it.item + ' (SKU ' + it.sku + ')', 'Menge: ' + data.qty, 'LS-Nr.: ' + LB_norm(data.lsNo),
        'LOT: ' + (v.lotText || '–'), 'Sales: Zeile ' + row + ', Status ' + shipped]
    });
  });
}

/** C) Korrektur in Correction. */
function bookCorrection(input) {
  var email = LB_requireUser();
  return LB_withLock(function () {
    var ss = LB_ss(), it = LB_findItem(ss, input.item);
    var data = { member: input.member, type: input.type, qty: Number(input.qty), lot: input.lot, notes: input.notes };
    var v = LB_validateCorrection(data, { members: LB_members(ss), types: LB_correctionTypes(ss), item: it, lots: it ? LB_lotsFor(ss, it.item) : [], today: LB_today() });
    if (v.errors.length || (v.warnings.length && !input.confirm)) return LB_result(v);

    var id = LB_bookingId(), sh = LB_sheet(ss, 'corr'), row = LB_insertTopRow(sh);
    LB_writeInputs(sh, row, {
      'Date': LB_today(),
      'Created By': LB_norm(data.member),
      'Item': it.item,
      'Quantity': data.qty,
      'Type': v.typeName,   // Rohwert aus Setup (inkl. führender Leerzeichen)
      'Notes': LB_joinNotes([data.notes, '[' + id + ']']),
      'LOT': v.lot ? v.lot.lot : ''
    });
    LB_log(ss, { id: id, member: data.member, email: email, kind: 'Korrektur ' + (v.sign > 0 ? '(+)' : '(−)'), sku: it.sku, item: it.item, qty: data.qty, lot: v.lot ? v.lot.lot : '', sheet: 'Correction', row: row, note: LB_norm(data.notes) });
    SpreadsheetApp.flush();
    return LB_result({ errors: [], warnings: [] }, {
      ok: true, id: id,
      summary: ['Korrektur gebucht (' + id + ')', it.item + ' (SKU ' + it.sku + ')', (v.sign > 0 ? 'Zugang +' : 'Abgang −') + data.qty,
        'LOT: ' + (v.lot ? v.lot.lot : '–'), 'Correction: Zeile ' + row]
    });
  });
}
