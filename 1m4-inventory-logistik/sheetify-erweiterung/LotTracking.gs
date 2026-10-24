/**
 * 1M4 Inventory – LOT-Tracking (FEFO/FIFO)
 *
 * Ergänzt die Sheetify-Inventory-Vorlage um LOT-Rückverfolgung:
 *  - Tab "LOTs": LOT-Register + Übersicht (Eingang, Verfall, Sperre, Restbestand)
 *  - Sales, Spalte "LOT": wird beim Status "Shipped" automatisch und fest befüllt
 *    Format: "L-001 (3); L-002 (2)"; fehlt LOT-Bestand -> "OHNE LOT (n)"
 *  - Reihenfolge: zuerst kürzestes Verfallsdatum (FEFO), LOTs ohne Verfall danach
 *    nach Eingangsdatum (FIFO). Gesperrte und abgelaufene LOTs werden übersprungen.
 *
 * Alle Namen haben das Präfix LOT_, damit nichts mit dem Sheetify-Script kollidiert.
 * Einmalig im Script-Editor die Funktion LOT_install ausführen.
 */

var LOT_CFG = {
  lotSheet: 'LOTs',
  salesSheet: 'Sales',
  purchSheet: 'Purchases',
  setupSheet: 'Setup',
  shippedCell: 'G11',          // Setup: Sales-Status "Shipped"
  headerRow: 5,
  firstRow: 6,
  none: 'OHNE LOT',
  blocked: 'Gesperrt',
  // Spalten im Tab LOTs (1-basiert)
  col: { received: 2, item: 3, sku: 4, lot: 5, expiry: 6, qty: 7, source: 8, lock: 9, rest: 12, status: 13 }
};

/* ------------------------------------------------------------------ */
/* Reine Logik (ohne Spreadsheet-Zugriff, lokal testbar)               */
/* ------------------------------------------------------------------ */

/** "L-1 (3); OHNE LOT (2)" -> [{lot:'L-1', qty:3}, {lot:'OHNE LOT', qty:2}] */
function LOT_parse(text) {
  var parts = [];
  String(text || '').split(';').forEach(function (s) {
    var m = s.trim().match(/^(.*\S)\s*\((\d+)\)$/);
    if (m) parts.push({ lot: m[1].trim(), qty: Number(m[2]) });
  });
  return parts;
}

/** Fasst gleiche LOTs zusammen, "OHNE LOT" ans Ende. */
function LOT_format(parts) {
  var order = [], sum = {};
  parts.forEach(function (p) {
    if (!p.qty) return;
    if (!(p.lot in sum)) { order.push(p.lot); sum[p.lot] = 0; }
    sum[p.lot] += p.qty;
  });
  order.sort(function (a, b) { return (a === LOT_CFG.none) - (b === LOT_CFG.none); });
  return order.map(function (l) { return l + ' (' + sum[l] + ')'; }).join('; ');
}

function LOT_sum(parts) {
  return parts.reduce(function (s, p) { return s + p.qty; }, 0);
}

function LOT_dayStart(d) {
  var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x;
}

/**
 * Verteilt qty auf die LOTs eines Artikels (FEFO, dann FIFO).
 * lots: [{lot, rest, expiry: Date|null, received: Date|null, blocked: bool, row}]
 * rest wird im Speicher reduziert. Rückgabe: [{lot, qty}], ggf. mit OHNE LOT.
 */
function LOT_allocate(lots, qty, refDate) {
  var ref = LOT_dayStart(refDate || new Date());
  var key = function (d) { return d ? d.getTime() : Infinity; };
  var cands = lots.filter(function (l) {
    return !l.blocked && l.rest > 0 && !(l.expiry && l.expiry < ref);
  }).sort(function (a, b) {
    return (key(a.expiry) - key(b.expiry)) || (key(a.received) - key(b.received)) || (a.row - b.row);
  });
  var parts = [], open = qty;
  for (var i = 0; i < cands.length && open > 0; i++) {
    var take = Math.min(cands[i].rest, open);
    cands[i].rest -= take;
    open -= take;
    parts.push({ lot: cands[i].lot, qty: take });
  }
  if (open > 0) parts.push({ lot: LOT_CFG.none, qty: open });
  return parts;
}

/** Gibt die Mengen einer bestehenden Zuordnung an die LOTs zurück. */
function LOT_release(lots, parts) {
  parts.forEach(function (p) {
    lots.forEach(function (l) { if (l.lot === p.lot) l.rest += p.qty; });
  });
}

/**
 * Bestimmt den neuen LOT-Text einer Verkaufszeile.
 * mode: 'auto'  – leer -> zuordnen; Menge passt nicht oder itemChanged -> neu zuordnen
 *       'fill'  – leer -> zuordnen; "OHNE LOT"-Anteil nachträglich zuordnen
 *       'force' – immer komplett neu zuordnen
 * Rückgabe: neuer Text oder null (keine Änderung).
 */
function LOT_processRow(lots, row, mode) {
  if (!lots || !lots.length || !(row.qty > 0)) return null;
  var old = LOT_parse(row.lotText);
  var parts;
  if (!old.length) {
    parts = LOT_allocate(lots, row.qty, row.refDate);
  } else if (mode === 'force' || (mode === 'auto' && (row.itemChanged || LOT_sum(old) !== row.qty))) {
    LOT_release(lots, old.filter(function (p) { return p.lot !== LOT_CFG.none; }));
    parts = LOT_allocate(lots, row.qty, row.refDate);
  } else if (mode === 'fill' && old.some(function (p) { return p.lot === LOT_CFG.none; })) {
    var keep = old.filter(function (p) { return p.lot !== LOT_CFG.none; });
    var missing = row.qty - LOT_sum(keep);
    if (missing < 0) { // Menge wurde reduziert -> sauber neu zuordnen
      LOT_release(lots, keep);
      parts = LOT_allocate(lots, row.qty, row.refDate);
    } else {
      parts = keep.concat(LOT_allocate(lots, missing, row.refDate));
    }
  } else {
    return null;
  }
  var text = LOT_format(parts);
  return text === String(row.lotText || '').trim() ? null : text;
}

/* ------------------------------------------------------------------ */
/* Spreadsheet-Anbindung                                               */
/* ------------------------------------------------------------------ */

function LOT_headerMap(sheet) {
  var h = sheet.getRange(LOT_CFG.headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  h.forEach(function (v, i) { map[String(v).replace(/\s+/g, ' ').trim()] = i + 1; });
  return map;
}

function LOT_need(map, name, sheetName) {
  if (!map[name]) throw new Error('Spalte "' + name + '" in "' + sheetName + '" (Zeile ' + LOT_CFG.headerRow + ') nicht gefunden.');
  return map[name];
}

function LOT_shippedStatus(ss) {
  return String(ss.getSheetByName(LOT_CFG.setupSheet).getRange(LOT_CFG.shippedCell).getValue()).trim();
}

function LOT_asDate(v) {
  return (v instanceof Date && !isNaN(v)) ? v : null;
}

/** Lädt alle LOTs gruppiert nach Artikel (Restbestand aus den Formeln). */
function LOT_loadLots(ss) {
  SpreadsheetApp.flush();
  var sh = ss.getSheetByName(LOT_CFG.lotSheet);
  var n = sh.getLastRow() - LOT_CFG.firstRow + 1;
  var byItem = {};
  if (n <= 0) return byItem;
  var c = LOT_CFG.col;
  var vals = sh.getRange(LOT_CFG.firstRow, 1, n, c.status).getValues();
  vals.forEach(function (r, i) {
    var item = String(r[c.item - 1]).trim(), lot = String(r[c.lot - 1]).trim();
    if (!item || !lot) return;
    (byItem[item] = byItem[item] || []).push({
      lot: lot,
      rest: Number(r[c.rest - 1]) || 0,
      expiry: LOT_asDate(r[c.expiry - 1]),
      received: LOT_asDate(r[c.received - 1]),
      blocked: String(r[c.lock - 1]).trim() === LOT_CFG.blocked,
      row: LOT_CFG.firstRow + i
    });
  });
  return byItem;
}

/**
 * Ordnet LOTs für die angegebenen Sales-Zeilen zu.
 * rows: Zeilennummern oder null (= alle). itemChangedRows: Set-ähnliches Objekt.
 */
function LOT_runSales(rows, mode, itemChangedRows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var sh = ss.getSheetByName(LOT_CFG.salesSheet);
    var map = LOT_headerMap(sh);
    var cItem = LOT_need(map, 'Item', sh.getName()), cQty = LOT_need(map, 'QTY', sh.getName());
    var cStatus = LOT_need(map, 'Status', sh.getName()), cLot = LOT_need(map, 'LOT', sh.getName());
    var cDate = map['Order Date'];
    var last = sh.getLastRow();
    if (last < LOT_CFG.firstRow) return { changed: 0, missing: 0 };
    var width = Math.max(cItem, cQty, cStatus, cLot, cDate || 1);
    var data = sh.getRange(LOT_CFG.firstRow, 1, last - LOT_CFG.firstRow + 1, width).getValues();
    var shipped = LOT_shippedStatus(ss);
    var lotsByItem = LOT_loadLots(ss);

    var todo = rows ? rows.slice() : data.map(function (_, i) { return LOT_CFG.firstRow + i; });
    // ältere Aufträge zuerst bedienen
    todo.sort(function (a, b) {
      var da = LOT_asDate(cDate ? data[a - LOT_CFG.firstRow][cDate - 1] : null);
      var db = LOT_asDate(cDate ? data[b - LOT_CFG.firstRow][cDate - 1] : null);
      return ((da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity)) || (a - b);
    });

    var changed = 0, missing = 0;
    todo.forEach(function (r) {
      var v = data[r - LOT_CFG.firstRow];
      if (!v || String(v[cStatus - 1]).trim() !== shipped) return;
      var item = String(v[cItem - 1]).trim();
      var text = LOT_processRow(lotsByItem[item], {
        qty: Number(v[cQty - 1]) || 0,
        lotText: v[cLot - 1],
        refDate: LOT_asDate(cDate ? v[cDate - 1] : null) || new Date(),
        itemChanged: !!(itemChangedRows && itemChangedRows[r])
      }, mode);
      if (text === null) return;
      sh.getRange(r, cLot).setValue(text);
      changed++;
      if (text.indexOf(LOT_CFG.none) !== -1) missing++;
    });
    return { changed: changed, missing: missing };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Trigger                                                             */
/* ------------------------------------------------------------------ */

function LOT_onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName();
  var r0 = e.range.getRow(), r1 = e.range.getLastRow();
  if (r1 < LOT_CFG.firstRow) return;
  r0 = Math.max(r0, LOT_CFG.firstRow);
  var c0 = e.range.getColumn(), c1 = e.range.getLastColumn();
  var hit = function (col) { return col && col >= c0 && col <= c1; };

  if (name === LOT_CFG.salesSheet) {
    var map = LOT_headerMap(sh);
    var cItem = map['Item'], cQty = map['QTY'], cStatus = map['Status'];
    if (!(hit(cItem) || hit(cQty) || hit(cStatus))) return;
    var rows = [], itemChanged = {};
    for (var r = r0; r <= r1; r++) { rows.push(r); if (hit(cItem)) itemChanged[r] = true; }
    var res = LOT_runSales(rows, 'auto', itemChanged);
    if (res.missing) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Nicht genug freier LOT-Bestand – Teilmenge als "OHNE LOT" gebucht. Bitte LOT im Tab LOTs erfassen und dann "Offene Zuordnungen nachholen".',
        'LOT', 10);
    }
    return;
  }

  if (name === LOT_CFG.purchSheet && r0 === r1) {
    var pm = LOT_headerMap(sh);
    var cSt = pm['Status'];
    if (!hit(cSt) || String(sh.getRange(r0, cSt).getValue()).indexOf('Received') === -1) return;
    LOT_offerReceipt(sh, pm, r0);
  }
}

/** Beim Wareneingang eine vorbefüllte Zeile im Tab LOTs anlegen. */
function LOT_offerReceipt(sh, pm, r) {
  var get = function (h) { return pm[h] ? sh.getRange(r, pm[h]).getValue() : ''; };
  var item = String(get('Item')).trim();
  if (!item) return;
  var qty = Number(get('Recieved QTY')) || Number(get('Purchase QTY')) || 0;
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert('LOT erfassen',
    'Wareneingang: ' + qty + ' × ' + item + '\n\nVorbefüllte Zeile im Tab "LOTs" anlegen?\n' +
    '(LOT-Nummer und ggf. Verfallsdatum danach eintragen. Mehrere LOTs: Zeile kopieren und Mengen aufteilen.)',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;

  var ss = sh.getParent(), lsh = ss.getSheetByName(LOT_CFG.lotSheet), c = LOT_CFG.col;
  var n = lsh.getMaxRows() - LOT_CFG.firstRow + 1;
  var vals = lsh.getRange(LOT_CFG.firstRow, c.item, n, c.lot - c.item + 1).getValues();
  var target = -1;
  for (var i = 0; i < vals.length; i++) {
    if (!String(vals[i][0]).trim() && !String(vals[i][c.lot - c.item]).trim()) { target = LOT_CFG.firstRow + i; break; }
  }
  if (target < 0) { ui.alert('Tab "LOTs" ist voll – bitte Zeilen (inkl. Formeln) nach unten erweitern.'); return; }
  var id = get('ID');
  lsh.getRange(target, c.received).setValue(LOT_asDate(get('Recieved Date')) || new Date());
  lsh.getRange(target, c.item).setValue(item);
  lsh.getRange(target, c.qty).setValue(qty);
  lsh.getRange(target, c.source).setValue('Purchase' + (id ? ' ' + id : '') + ' (Zeile ' + r + ')');
  lsh.getRange(target, c.lock).setValue('Frei');
  ss.setActiveSheet(lsh);
  lsh.getRange(target, c.lot).activate();
}

function LOT_onOpen() {
  SpreadsheetApp.getUi().createMenu('🏷️ LOT')
    .addItem('LOT für markierte Verkaufszeilen neu zuordnen', 'LOT_menuSelected')
    .addItem('Offene Zuordnungen nachholen (leer / OHNE LOT)', 'LOT_menuFill')
    .addSeparator()
    .addItem('Prüfung: SKU-Bestand vs. LOT-Bestand', 'LOT_menuCheck')
    .addToUi();
}

function LOT_menuSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), rng = ss.getActiveRange();
  if (!rng || rng.getSheet().getName() !== LOT_CFG.salesSheet) {
    SpreadsheetApp.getUi().alert('Bitte zuerst im Tab "Sales" die Zeilen markieren.');
    return;
  }
  var rows = [];
  for (var r = Math.max(rng.getRow(), LOT_CFG.firstRow); r <= rng.getLastRow(); r++) rows.push(r);
  var res = LOT_runSales(rows, 'force');
  ss.toast(res.changed + ' Zeile(n) neu zugeordnet' + (res.missing ? ', davon ' + res.missing + ' mit OHNE LOT' : '') + '.', 'LOT', 6);
}

function LOT_menuFill() {
  var res = LOT_runSales(null, 'fill');
  SpreadsheetApp.getActiveSpreadsheet().toast(
    res.changed + ' Zeile(n) aktualisiert' + (res.missing ? ', ' + res.missing + ' weiterhin mit OHNE LOT' : '') + '.', 'LOT', 6);
}

function LOT_menuCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  SpreadsheetApp.flush();
  var inv = ss.getSheetByName('Inventory'), map = LOT_headerMap(inv);
  var cItem = LOT_need(map, 'Item', 'Inventory'), cDiff = LOT_need(map, 'Ohne LOT', 'Inventory');
  var n = inv.getLastRow() - LOT_CFG.firstRow + 1, msgs = [];
  if (n > 0) {
    inv.getRange(LOT_CFG.firstRow, 1, n, Math.max(cItem, cDiff)).getValues().forEach(function (r) {
      var d = r[cDiff - 1];
      if (typeof d === 'number' && d !== 0) {
        msgs.push('• ' + r[cItem - 1] + ': ' + (d > 0 ? d + ' Stk. ohne erfasste LOT' : (-d) + ' Stk. mehr in LOTs als im SKU-Bestand'));
      }
    });
  }
  var seen = {}, lots = LOT_loadLots(ss);
  Object.keys(lots).forEach(function (item) {
    lots[item].forEach(function (l) {
      var k = item + '|' + l.lot;
      if (seen[k]) msgs.push('• Doppelte LOT "' + l.lot + '" bei ' + item + ' (Zeilen ' + seen[k] + ' und ' + l.row + ')');
      seen[k] = l.row;
      if (l.rest < 0) msgs.push('• Negativer Restbestand: ' + item + ' / ' + l.lot + ' (' + l.rest + ')');
    });
  });
  SpreadsheetApp.getUi().alert('LOT-Prüfung', msgs.length ? msgs.join('\n') : 'Alles stimmig: SKU-Bestand und LOT-Bestand passen zusammen.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ------------------------------------------------------------------ */
/* Einrichtung (einmalig im Script-Editor ausführen)                   */
/* ------------------------------------------------------------------ */

function LOT_install() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['LOT_onEdit', 'LOT_onOpen'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('LOT_onEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('LOT_onOpen').forSpreadsheet(ss).onOpen().create();

  // Darstellung Tab LOTs
  var sh = ss.getSheetByName(LOT_CFG.lotSheet), c = LOT_CFG.col, rows = sh.getMaxRows() - LOT_CFG.firstRow + 1;
  sh.getRange('B3').setFontSize(18).setFontWeight('bold');
  sh.getRange('L3').setHorizontalAlignment('right').setFontColor('#666666');
  sh.getRange('M3').setFontWeight('bold').setBackground('#fff2cc');
  sh.getRange(LOT_CFG.headerRow, 2, 1, 14).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff')
    .setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(LOT_CFG.headerRow, 40);
  sh.getRange(LOT_CFG.firstRow, c.lot, rows, 1).setNumberFormat('@');      // LOT als Text (führende Nullen bleiben)
  sh.getRange(LOT_CFG.firstRow, c.received, rows, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(LOT_CFG.firstRow, c.expiry, rows, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(LOT_CFG.firstRow, 7, rows, 6).setNumberFormat('0');
  sh.getRange(LOT_CFG.firstRow, 4, rows, 1).setFontColor('#666666');
  sh.getRange(LOT_CFG.firstRow, 10, rows, 5).setBackground('#f3f3f3');    // berechnete Spalten
  var widths = { 1: 20, 2: 105, 3: 230, 4: 80, 5: 110, 6: 105, 7: 80, 8: 170, 9: 85, 10: 80, 11: 85, 12: 90, 13: 150, 14: 95, 15: 220 };
  Object.keys(widths).forEach(function (k) { sh.setColumnWidth(Number(k), widths[k]); });
  if (!sh.getFilter()) sh.getRange(LOT_CFG.headerRow, 2, rows + 1, 14).createFilter();

  ss.getSheetByName(LOT_CFG.salesSheet).setColumnWidth(14, 200);
  ss.getSheetByName('Correction').setColumnWidth(14, 120);
  LOT_onOpen();
  ss.toast('LOT-Tracking eingerichtet. Menü "🏷️ LOT" ist aktiv.', 'LOT', 8);
}
