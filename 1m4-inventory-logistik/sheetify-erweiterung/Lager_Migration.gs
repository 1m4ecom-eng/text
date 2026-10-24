/**
 * 1M4 Inventory – Lager-Migration (nach LAGER_setup). Wiederholbar, überschreibt nie.
 *
 *  MIG_dryRun()  – nur Bericht im Tab "Migration_Bericht", schreibt keine Lager-Werte
 *  MIG_apply()   – füllt LEERE Lager-Zellen in Sales, Purchases, Correction, LOTs
 *
 * Regel: Lager = Inventory "Warehouse" des Artikels. Fehlt es oder ist es kein Lager aus
 * Setup "Warehouse", bleibt die Zeile leer und steht als "unklar" im Bericht.
 */

var MIG_CFG = {
  headerRow: 5,
  targets: [
    { sheet: 'Sales', first: 7 },
    { sheet: 'Purchases', first: 7 },
    { sheet: 'Correction', first: 7 },
    { sheet: 'LOTs', first: 6 }
  ],
  report: 'Migration_Bericht'
};

function MIG_norm(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }

/* ------------------------------------------------------------------ */
/* Reine Logik (lokal testbar)                                         */
/* ------------------------------------------------------------------ */

/**
 * rows: [{sheet, row, item, lager}]  (lager = aktueller Wert)
 * whByItem: {item: warehouse}, lagers: [..]
 * Rückgabe: {assign: [{sheet,row,item,lager}], unclear: [{sheet,row,item,reason}], kept: n}
 */
function MIG_plan(rows, whByItem, lagers) {
  var res = { assign: [], unclear: [], kept: 0 };
  rows.forEach(function (r) {
    var item = MIG_norm(r.item);
    if (!item) return;
    if (MIG_norm(r.lager)) { res.kept++; return; }
    var wh = MIG_norm(whByItem[item]);
    if (!(item in whByItem)) res.unclear.push({ sheet: r.sheet, row: r.row, item: item, reason: 'Artikel nicht in Inventory' });
    else if (!wh) res.unclear.push({ sheet: r.sheet, row: r.row, item: item, reason: 'kein Warehouse in Inventory' });
    else if (lagers.indexOf(wh) === -1) res.unclear.push({ sheet: r.sheet, row: r.row, item: item, reason: 'Warehouse "' + wh + '" ist kein Lager in Setup' });
    else res.assign.push({ sheet: r.sheet, row: r.row, item: item, lager: wh });
  });
  return res;
}

/* ------------------------------------------------------------------ */
/* Spreadsheet-Anbindung                                               */
/* ------------------------------------------------------------------ */

function MIG_headerMap(sh) {
  var h = sh.getRange(MIG_CFG.headerRow, 1, 1, sh.getLastColumn()).getValues()[0], map = {};
  h.forEach(function (v, i) { var k = MIG_norm(v); if (k && !map[k]) map[k] = i + 1; });
  return map;
}

function MIG_lagers(ss) {
  var setup = ss.getSheetByName('Setup');
  var vals = setup.getRange(1, 1, 60, setup.getLastColumn()).getValues();
  for (var r = 0; r < vals.length; r++) for (var c = 0; c < vals[r].length; c++) {
    if (MIG_norm(vals[r][c]) === 'Warehouse') {
      return setup.getRange(r + 2, c + 1, 18, 1).getValues().map(function (x) { return MIG_norm(x[0]); }).filter(String);
    }
  }
  throw new Error('Überschrift "Warehouse" in Setup nicht gefunden.');
}

function MIG_collect(ss) {
  var inv = ss.getSheetByName('Inventory'), im = MIG_headerMap(inv);
  if (!im['Item'] || !im['Warehouse']) throw new Error('Inventory: Spalten "Item"/"Warehouse" nicht gefunden.');
  var n = inv.getLastRow() - 6, whByItem = {};
  if (n > 0) inv.getRange(7, 1, n, Math.max(im['Item'], im['Warehouse'])).getValues().forEach(function (r) {
    var it = MIG_norm(r[im['Item'] - 1]);
    if (it && !(it in whByItem)) whByItem[it] = MIG_norm(r[im['Warehouse'] - 1]);
  });
  var rows = [], cols = {};
  MIG_CFG.targets.forEach(function (t) {
    var sh = ss.getSheetByName(t.sheet), m = MIG_headerMap(sh);
    if (!m['Lager']) throw new Error('Spalte "Lager" in "' + t.sheet + '" fehlt – zuerst LAGER_setup ausführen.');
    if (!m['Item']) throw new Error('Spalte "Item" in "' + t.sheet + '" fehlt.');
    cols[t.sheet] = { item: m['Item'], lager: m['Lager'] };
    var cnt = sh.getLastRow() - t.first + 1;
    if (cnt <= 0) return;
    sh.getRange(t.first, 1, cnt, Math.max(m['Item'], m['Lager'])).getValues().forEach(function (r, i) {
      rows.push({ sheet: t.sheet, row: t.first + i, item: r[m['Item'] - 1], lager: r[m['Lager'] - 1] });
    });
  });
  return { rows: rows, whByItem: whByItem, lagers: MIG_lagers(ss), cols: cols };
}

function MIG_report(ss, plan, applied) {
  var sh = ss.getSheetByName(MIG_CFG.report) || ss.insertSheet(MIG_CFG.report);
  sh.clear();
  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm');
  var head = [[(applied ? 'ANGEWENDET' : 'TROCKENLAUF (nichts geschrieben)') + ' – ' + stamp, '', '', '', ''],
    ['Zuzuordnen: ' + plan.assign.length, 'Unklar: ' + plan.unclear.length, 'Bereits gesetzt: ' + plan.kept, '', ''],
    ['', '', '', '', ''],
    ['Tab', 'Zeile', 'Artikel', 'Lager', 'Ergebnis']];
  var body = plan.assign.map(function (a) { return [a.sheet, a.row, a.item, a.lager, applied ? 'gesetzt' : 'wird gesetzt']; })
    .concat(plan.unclear.map(function (u) { return [u.sheet, u.row, u.item, '', 'UNKLAR: ' + u.reason]; }));
  sh.getRange(1, 1, head.length, 5).setValues(head);
  sh.getRange(1, 1).setFontWeight('bold');
  sh.getRange(4, 1, 1, 5).setFontWeight('bold');
  if (body.length) sh.getRange(5, 1, body.length, 5).setValues(body);
  sh.setFrozenRows(4);
}

function MIG_dryRun() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), c = MIG_collect(ss), plan = MIG_plan(c.rows, c.whByItem, c.lagers);
  MIG_report(ss, plan, false);
  ss.toast('Trockenlauf: ' + plan.assign.length + ' zuzuordnen, ' + plan.unclear.length + ' unklar, ' + plan.kept + ' bereits gesetzt. Siehe Tab "' + MIG_CFG.report + '".', 'Migration', 10);
  return { assign: plan.assign.length, unclear: plan.unclear.length, kept: plan.kept };
}

function MIG_apply() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var c = MIG_collect(ss), plan = MIG_plan(c.rows, c.whByItem, c.lagers);
    var bySheet = {};
    plan.assign.forEach(function (a) { (bySheet[a.sheet] = bySheet[a.sheet] || []).push(a); });
    Object.keys(bySheet).forEach(function (name) {
      var sh = ss.getSheetByName(name), col = c.cols[name].lager, list = bySheet[name];
      var r0 = Math.min.apply(null, list.map(function (a) { return a.row; })), r1 = Math.max.apply(null, list.map(function (a) { return a.row; }));
      var rng = sh.getRange(r0, col, r1 - r0 + 1, 1), vals = rng.getValues();
      list.forEach(function (a) { if (!MIG_norm(vals[a.row - r0][0])) vals[a.row - r0][0] = a.lager; });
      rng.setValues(vals);
    });
    SpreadsheetApp.flush();
    MIG_report(ss, plan, true);
    ss.toast('Migration: ' + plan.assign.length + ' Zeilen gesetzt, ' + plan.unclear.length + ' unklar. Siehe Tab "' + MIG_CFG.report + '".', 'Migration', 10);
    return { assign: plan.assign.length, unclear: plan.unclear.length, kept: plan.kept };
  } finally {
    lock.releaseLock();
  }
}

if (typeof module !== 'undefined') module.exports = { MIG_plan: MIG_plan };
