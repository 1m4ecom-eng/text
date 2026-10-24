/**
 * 1M4 Inventory – externe Bestandsansicht (read-only Kopie als reine Werte).
 *
 * Läuft im Sheetify-Projekt unter dem Besitzerkonto (Zeittrigger), kein IMPORTRANGE.
 * Script Property: BE_EXTERNAL_ID = ID der externen Tabelle "1M4 Bestand extern".
 * Einmalig im Script-Editor BE_install ausführen.
 *
 * Bestand = Stock On Hand − Restbestand gesperrter oder abgelaufener LOTs, mindestens 0.
 * Filter:  Type "Product", SKU beginnt nicht mit "8", ohne BE_CFG.excludeSku.
 */

var BE_CFG = {
  headerRow: 5,
  invFirstRow: 7,          // Inventory: Zeile 6 = ausgeblendete Vorlage
  lotFirstRow: 6,
  invSheet: 'Inventory',
  lotSheet: 'LOTs',
  logSheet: 'Buchungslog',
  targetSheet: 'Bestand',
  includeType: 'Product',
  excludeSku: ['EH 157', 'EH 193', '12000.99'],
  blocked: 'Gesperrt',
  title: '1M4 OÜ – Warenbestand'
};

/* ------------------------------------------------------------------ */
/* Reine Logik (lokal testbar)                                         */
/* ------------------------------------------------------------------ */

function BE_norm(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
}

function BE_isIncluded(r) {
  var sku = BE_norm(r.sku);
  return BE_norm(r.type) === BE_CFG.includeType && !!sku && sku.charAt(0) !== '8' && BE_CFG.excludeSku.indexOf(sku) === -1;
}

/** Nicht verkaufsfähige LOT-Menge je Artikel (gesperrt oder abgelaufen, Restbestand > 0). */
function BE_unavailableByItem(lots, today) {
  var ref = new Date(today.getTime()); ref.setHours(0, 0, 0, 0);
  var out = {};
  lots.forEach(function (l) {
    if (!(l.rest > 0)) return;
    if (l.blocked || (l.expiry && l.expiry < ref)) out[l.item] = (out[l.item] || 0) + l.rest;
  });
  return out;
}

/** inv: [{item, sku, ean, type, stock}] -> [[SKU, EAN, Produktname, Bestand]] */
function BE_buildRows(inv, lots, today) {
  var minus = BE_unavailableByItem(lots, today);
  return inv.filter(BE_isIncluded).map(function (r) {
    var stock = typeof r.stock === 'number' ? r.stock : 0;
    var ean = BE_norm(r.ean);
    return [BE_norm(r.sku), /^\d{8,14}$/.test(ean) ? ean : '', BE_norm(r.item), Math.max(0, stock - (minus[BE_norm(r.item)] || 0))];
  });
}

/* ------------------------------------------------------------------ */
/* Spreadsheet-Anbindung                                               */
/* ------------------------------------------------------------------ */

function BE_headerMap(sh) {
  var h = sh.getRange(BE_CFG.headerRow, 1, 1, sh.getLastColumn()).getValues()[0], map = {};
  h.forEach(function (v, i) { var k = BE_norm(v); if (k && !map[k]) map[k] = i + 1; });
  return map;
}

function BE_need(map, name, sheet) {
  if (!map[name]) throw new Error('Spalte "' + name + '" in "' + sheet + '" nicht gefunden.');
  return map[name];
}

function BE_readInventory(ss) {
  var sh = ss.getSheetByName(BE_CFG.invSheet), m = BE_headerMap(sh);
  var c = { item: BE_need(m, 'Item', 'Inventory'), sku: BE_need(m, 'SKU', 'Inventory'), ean: BE_need(m, 'EAN', 'Inventory'),
    type: BE_need(m, 'Type', 'Inventory'), stock: BE_need(m, 'Stock On Hand', 'Inventory') };
  var n = sh.getLastRow() - BE_CFG.invFirstRow + 1;
  if (n <= 0) return [];
  var rng = sh.getRange(BE_CFG.invFirstRow, 1, n, Math.max(c.item, c.sku, c.ean, c.type, c.stock));
  var v = rng.getValues(), d = rng.getDisplayValues();
  return v.map(function (r, i) {
    return { item: BE_norm(r[c.item - 1]), sku: BE_norm(d[i][c.sku - 1]), ean: BE_norm(d[i][c.ean - 1]), type: BE_norm(r[c.type - 1]), stock: r[c.stock - 1] };
  }).filter(function (r) { return r.item; });
}

function BE_readLots(ss) {
  var sh = ss.getSheetByName(BE_CFG.lotSheet), m = BE_headerMap(sh);
  var c = { item: BE_need(m, 'Item', 'LOTs'), lot: BE_need(m, 'LOT', 'LOTs'), expiry: BE_need(m, 'Verfallsdatum', 'LOTs'),
    lock: BE_need(m, 'Sperre', 'LOTs'), rest: BE_need(m, 'Restbestand', 'LOTs') };
  var n = sh.getLastRow() - BE_CFG.lotFirstRow + 1;
  if (n <= 0) return [];
  return sh.getRange(BE_CFG.lotFirstRow, 1, n, Math.max(c.item, c.lot, c.expiry, c.lock, c.rest)).getValues()
    .filter(function (r) { return BE_norm(r[c.item - 1]) && BE_norm(r[c.lot - 1]); })
    .map(function (r) {
      var e = r[c.expiry - 1];
      return { item: BE_norm(r[c.item - 1]), rest: Number(r[c.rest - 1]) || 0, blocked: BE_norm(r[c.lock - 1]) === BE_CFG.blocked,
        expiry: (e instanceof Date && !isNaN(e)) ? e : null };
    });
}

function BE_target() {
  var id = PropertiesService.getScriptProperties().getProperty('BE_EXTERNAL_ID');
  if (!id) throw new Error('Skripteigenschaft BE_EXTERNAL_ID fehlt.');
  var ext = SpreadsheetApp.openById(id);
  var sh = ext.getSheetByName(BE_CFG.targetSheet) || ext.getSheets()[0].setName(BE_CFG.targetSheet);
  return { ss: ext, sh: sh };
}

/** Schreibt den externen Bestand neu (nur Werte). */
function BE_refresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    SpreadsheetApp.flush();
    var now = new Date(), rows = BE_buildRows(BE_readInventory(ss), BE_readLots(ss), now);
    var t = BE_target(), sh = t.sh;
    var stand = 'Stand: ' + Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm');
    sh.clear();
    sh.getRange(1, 1, 1, 2).setValues([[BE_CFG.title, stand]]).setFontWeight('bold');
    sh.getRange(3, 1, 1, 4).setValues([['Artikelnummer (SKU)', 'EAN', 'Produktname', 'Bestand']])
      .setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');
    if (rows.length) {
      sh.getRange(4, 1, rows.length, 2).setNumberFormat('@');
      sh.getRange(4, 4, rows.length, 1).setNumberFormat('0');
      sh.getRange(4, 1, rows.length, 4).setValues(rows);
    }
    sh.setFrozenRows(3);
    PropertiesService.getScriptProperties().setProperty('BE_LAST_REFRESH', String(now.getTime()));
  } finally {
    lock.releaseLock();
  }
}

/** Alle 10 Minuten: aktualisieren, wenn seit dem letzten Lauf gebucht wurde (Tab Buchungslog). */
function BE_checkPending() {
  var log = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CFG.logSheet);
  if (!log || log.getLastRow() < 2) return;
  var last = log.getRange(log.getLastRow(), 1).getValue();
  var done = Number(PropertiesService.getScriptProperties().getProperty('BE_LAST_REFRESH') || 0);
  if (last instanceof Date && last.getTime() > done) BE_refresh();
}

/** Schützt das Blatt der externen Datei: bearbeiten darf nur der Besitzer. */
function BE_protect() {
  var t = BE_target(), p = t.sh.protect().setDescription('Nur lesen – wird automatisch befüllt');
  var me = Session.getEffectiveUser();
  p.addEditor(me);
  p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); }));
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

/** Einmalig: Trigger anlegen (stündlich + 10-Minuten-Prüfung), Blatt schützen, erster Lauf. */
function BE_install() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['BE_refresh', 'BE_checkPending'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('BE_refresh').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('BE_checkPending').timeBased().everyMinutes(10).create();
  BE_protect();
  BE_refresh();
}

if (typeof module !== 'undefined') module.exports = { BE_isIncluded: BE_isIncluded, BE_buildRows: BE_buildRows, BE_CFG: BE_CFG };
