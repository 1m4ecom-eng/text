/**
 * 1M4 Inventory – Mehrlager-Einrichtung (einmalig, wiederholbar). Im Script-Editor LAGER_setup ausführen.
 *
 *  1. Spalte "Lager" am rechten Rand von Sales, Purchases, Correction, LOTs (Auswahl aus Setup "Warehouse")
 *  2. Korrekturtypen "🔁 Umlagerung (+)/(−)" in Setup unter "Correction Type" (+ Validierung in Correction)
 *  3. LOT-Formeln J (Ausgang Verkauf), K (Korrektur), N (Nächste) zusätzlich je Lager
 *  4. Tab "Bestand je Lager" (nur Formeln): Bestand je Lager, Gesamt, Stock On Hand, Abweichung
 *
 * Die Sheetify-Formel "Stock On Hand" in Inventory bleibt unverändert; sie zählt nur die beiden
 * Standard-Korrekturtypen, deshalb ändern Umlagerungen den Gesamtbestand nicht.
 * Spalten werden über die Kopfzeile (Zeile 5) gesucht. Nach einer Spaltenänderung erneut ausführen.
 */

var LAGER_CFG = {
  headerRow: 5,
  colName: 'Lager',
  validateFrom: { Sales: 6, Purchases: 6, Correction: 6, LOTs: 6 },
  lotFirstRow: 6,
  stockSheet: 'Bestand je Lager',
  transferPlus: '  🔁 Umlagerung (+)',
  transferMinus: '  🔁 Umlagerung (−)',
  received: '✅ Received',
  shippedCell: 'G11'
};

function LAGER_norm(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }

function LAGER_letter(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function LAGER_header(sh) {
  var h = sh.getRange(LAGER_CFG.headerRow, 1, 1, sh.getMaxColumns()).getValues()[0], map = {}, last = 0;
  h.forEach(function (v, i) { var k = LAGER_norm(v); if (k) { last = i + 1; if (!map[k]) map[k] = i + 1; } });
  map.__last = last;
  return map;
}

/** Spaltenbuchstaben für die angegebenen Überschriften (Fehler, wenn eine fehlt). */
function LAGER_cols(sh, names) {
  var map = LAGER_header(sh), out = {};
  Object.keys(names).forEach(function (k) {
    var c = map[names[k]];
    if (!c) throw new Error('Spalte "' + names[k] + '" in "' + sh.getName() + '" nicht gefunden.');
    out[k] = LAGER_letter(c);
  });
  return out;
}

function LAGER_find(sh, text) {
  var vals = sh.getRange(1, 1, Math.min(60, sh.getMaxRows()), sh.getLastColumn()).getValues();
  for (var r = 0; r < vals.length; r++) for (var c = 0; c < vals[r].length; c++) {
    if (LAGER_norm(vals[r][c]) === text) return { row: r + 1, col: c + 1 };
  }
  throw new Error('Überschrift "' + text + '" im Tab "' + sh.getName() + '" nicht gefunden.');
}

/** Ersetzt {Token} in einer Formelvorlage. */
function LAGER_fill(tpl, t) {
  return tpl.replace(/\{(\w+)\}/g, function (_, k) { if (!(k in t)) throw new Error('Token ' + k + ' fehlt.'); return t[k]; });
}

/**
 * Argument-Trennzeichen der Tabelle ermitteln. Formeln werden im Gebietsschema der Tabelle
 * geparst (de_DE: ";"). Prüfung über ein temporäres Blatt, das danach wieder gelöscht wird.
 */
function LAGER_separator(ss) {
  var tmp = ss.insertSheet('_lager_probe_' + new Date().getTime());
  try {
    var cell = tmp.getRange('A1');
    cell.setFormula('=IF(TRUE,1,2)');
    SpreadsheetApp.flush();
    if (cell.getValue() === 1) return ',';
    cell.setFormula('=IF(TRUE;1;2)');
    SpreadsheetApp.flush();
    if (cell.getValue() === 1) return ';';
    throw new Error('Formel-Trennzeichen der Tabelle konnte nicht ermittelt werden.');
  } finally {
    ss.deleteSheet(tmp);
  }
}

/** Ersetzt in einer Formel (mit "," geschrieben) die Trennzeichen außerhalb von Textliteralen. */
function LAGER_loc(formula, sep) {
  if (sep === ',') return formula;
  var out = '', inStr = false;
  for (var i = 0; i < formula.length; i++) {
    var ch = formula.charAt(i);
    if (ch === '"') inStr = !inStr;
    out += (!inStr && ch === ',') ? sep : ch;
  }
  return out;
}

function LAGER_setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), log = [];
  var setup = ss.getSheetByName('Setup');
  var sep = LAGER_separator(ss);
  log.push('Formel-Trennzeichen der Tabelle: "' + sep + '"');

  // 1) Lagerliste aus Setup
  var wh = LAGER_find(setup, 'Warehouse');
  var whCol = LAGER_letter(wh.col), whRange = setup.getRange(wh.row + 1, wh.col, 18, 1);
  var lagers = whRange.getValues().map(function (r) { return LAGER_norm(r[0]); }).filter(String);
  if (!lagers.length) throw new Error('Keine Lager unter "Warehouse" in Setup.');
  log.push('Lager: ' + lagers.join(', '));

  // 2) Korrekturtypen inkl. Umlagerung
  var ct = LAGER_find(setup, 'Correction Type'), first = ct.row + 1, n = 15;
  var tv = setup.getRange(first, ct.col, n, 2).getValues();
  var rowOf = function (name) { for (var i = 0; i < n; i++) if (LAGER_norm(tv[i][0]) === LAGER_norm(name)) return first + i; return 0; };
  var std = { plus: 0, minus: 0 }, lastUsed = first - 1;
  tv.forEach(function (r, i) {
    if (!LAGER_norm(r[0])) return;
    lastUsed = first + i;
    if (LAGER_norm(r[0]).indexOf('Umlagerung') !== -1) return;
    if (Number(r[1]) === 1 && !std.plus) std.plus = first + i;
    if (Number(r[1]) === -1 && !std.minus) std.minus = first + i;
  });
  if (!std.plus || !std.minus) throw new Error('Standard-Korrekturtypen (+/−) in Setup nicht gefunden.');
  [[LAGER_CFG.transferPlus, 1], [LAGER_CFG.transferMinus, -1]].forEach(function (t) {
    if (rowOf(t[0])) return;
    lastUsed++;
    setup.getRange(lastUsed, ct.col, 1, 2).setValues([[t[0], t[1]]]);
    tv[lastUsed - first] = [t[0], t[1]];
    log.push('Setup: Korrekturtyp "' + LAGER_norm(t[0]) + '" angelegt (Zeile ' + lastUsed + ')');
  });
  var tCol = LAGER_letter(ct.col), sCol = LAGER_letter(ct.col + 1);
  var cell = function (row) { return 'Setup!$' + tCol + '$' + row; };
  var types = { plus: cell(std.plus), minus: cell(std.minus), tplus: cell(rowOf(LAGER_CFG.transferPlus)), tminus: cell(rowOf(LAGER_CFG.transferMinus)),
    range: 'Setup!$' + tCol + '$' + first + ':$' + sCol + '$' + (first + n - 1) };

  // 3) Spalte "Lager" am rechten Rand + Validierung
  var lagerRule = SpreadsheetApp.newDataValidation().requireValueInRange(whRange, true).setAllowInvalid(false)
    .setHelpText('Lager aus Setup "Warehouse"').build();
  Object.keys(LAGER_CFG.validateFrom).forEach(function (name) {
    var sh = ss.getSheetByName(name), map = LAGER_header(sh), col = map[LAGER_CFG.colName];
    if (!col) {
      col = map.__last + 1;
      if (col > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
      sh.getRange(LAGER_CFG.headerRow, col - 1).copyTo(sh.getRange(LAGER_CFG.headerRow, col), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      sh.getRange(LAGER_CFG.headerRow, col).setValue(LAGER_CFG.colName);
      log.push(name + ': Spalte "Lager" in ' + LAGER_letter(col) + ' angelegt');
    }
    var r0 = LAGER_CFG.validateFrom[name];
    sh.getRange(r0, col, sh.getMaxRows() - r0 + 1, 1).setDataValidation(lagerRule);
  });

  // Correction: Typ-Validierung auf alle Korrekturtypen erweitern
  var corr = ss.getSheetByName('Correction'), cMap = LAGER_header(corr);
  var typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(setup.getRange(first, ct.col, n, 1), true).setAllowInvalid(false).build();
  corr.getRange(6, cMap['Type'], corr.getMaxRows() - 5, 1).setDataValidation(typeRule);

  // 4) LOT-Formeln je Lager
  var lots = ss.getSheetByName('LOTs');
  var L = LAGER_cols(lots, { rec: 'Eingangsdatum', item: 'Item', lot: 'LOT', exp: 'Verfallsdatum', status: 'Status', lager: 'Lager', aus: 'Ausgang Verkauf', korr: 'Korrektur (+/−)', next: 'Nächste' });
  var S = LAGER_cols(ss.getSheetByName('Sales'), { item: 'Item', status: 'Status', lot: 'LOT', lager: 'Lager' });
  var C = LAGER_cols(corr, { item: 'Item', qty: 'Quantity', type: 'Type', lot: 'LOT', lager: 'Lager' });
  var tok = {
    LI: L.item, LL: L.lot, LE: L.exp, LR: L.rec, LS: L.status, LG: L.lager,
    SI: S.item, SS: S.status, SL: S.lot, SG: S.lager, SH: 'Setup!$' + LAGER_CFG.shippedCell.replace(/(\D+)(\d+)/, '$1$$$2'),
    CI: C.item, CQ: C.qty, CT: C.type, CL: C.lot, CG: C.lager, TR: types.range
  };
  var fJ = '=IF(OR({LI}#="",{LL}#=""),"",IFERROR(ARRAYFORMULA(LET(t,FLATTEN(SPLIT(FILTER(Sales!${SL}$6:${SL},Sales!${SI}$6:${SI}={LI}#,Sales!${SS}$6:${SS}={SH},Sales!${SG}$6:${SG}={LG}#,Sales!${SL}$6:${SL}<>""),"; ",FALSE)),' +
    'SUM(IFERROR(IF(REGEXEXTRACT(t,"^(.*) \\(\\d+\\)$")=TO_TEXT({LL}#),VALUE(REGEXEXTRACT(t,"\\((\\d+)\\)$")),0),0)))),0))';
  var fK = '=IF(OR({LI}#="",{LL}#=""),"",ARRAYFORMULA(SUMPRODUCT((Correction!${CI}$6:${CI}={LI}#)*(TO_TEXT(Correction!${CL}$6:${CL})=TO_TEXT({LL}#))*(Correction!${CG}$6:${CG}={LG}#)' +
    '*IFERROR(Correction!${CQ}$6:${CQ}*1,0)*IFERROR(VLOOKUP(Correction!${CT}$6:${CT},{TR},2,FALSE),0))))';
  var fN = '=IF({LL}#="","",IF(TO_TEXT({LL}#)=IFERROR(ARRAYFORMULA(LET(ok,(${LI}$6:${LI}={LI}#)*(${LG}$6:${LG}={LG}#)*((${LS}$6:${LS}="✅ Verfügbar")+(${LS}$6:${LS}="⚠️ Läuft bald ab")),' +
    'INDEX(SORT(FILTER(TO_TEXT(${LL}$6:${LL}),ok),FILTER(IF(ISNUMBER(${LE}$6:${LE}),${LE}$6:${LE},99999),ok),TRUE,FILTER(IF(ISNUMBER(${LR}$6:${LR}),${LR}$6:${LR},99999),ok),TRUE,FILTER(ROW(${LL}$6:${LL}),ok),TRUE),1))),""),"➡️ Nächste",""))';
  var rows = lots.getMaxRows() - LAGER_CFG.lotFirstRow + 1;
  [[L.aus, fJ], [L.korr, fK], [L.next, fN]].forEach(function (x) {
    var tpl = LAGER_loc(LAGER_fill(x[1], tok), sep), arr = [];
    for (var i = 0; i < rows; i++) arr.push([tpl.replace(/#/g, String(LAGER_CFG.lotFirstRow + i))]);
    lots.getRange(x[0] + LAGER_CFG.lotFirstRow + ':' + x[0] + lots.getMaxRows()).setFormulas(arr);
  });
  log.push('LOTs: Formeln Ausgang Verkauf, Korrektur, Nächste je Lager gesetzt (' + rows + ' Zeilen)');

  // 5) Tab "Bestand je Lager"
  LAGER_buildStock(ss, lagers, types, sep);
  log.push('Tab "' + LAGER_CFG.stockSheet + '" aufgebaut');

  SpreadsheetApp.flush();
  Logger.log(log.join('\n'));
  ss.toast('Mehrlager eingerichtet. Details im Ausführungsprotokoll.', 'Lager', 8);
  return log;
}

function LAGER_buildStock(ss, lagers, types, sep) {
  var I = LAGER_cols(ss.getSheetByName('Inventory'), { item: 'Item', sku: 'SKU', wh: 'Warehouse', init: 'Initial Stock', soh: 'Stock On Hand' });
  var P = LAGER_cols(ss.getSheetByName('Purchases'), { item: 'Item', qty: 'Recieved QTY', status: 'Status', lager: 'Lager' });
  var S = LAGER_cols(ss.getSheetByName('Sales'), { item: 'Item', qty: 'QTY', status: 'Status', lager: 'Lager' });
  var C = LAGER_cols(ss.getSheetByName('Correction'), { item: 'Item', qty: 'Quantity', type: 'Type', lager: 'Lager' });
  var M = LAGER_cols(ss.getSheetByName('Manufacture'), { item: 'Item', qty: 'QTY' });

  var sh = ss.getSheetByName(LAGER_CFG.stockSheet) || ss.insertSheet(LAGER_CFG.stockSheet);
  sh.clear();
  var nL = lagers.length, cGes = 3 + nL, cSoh = cGes + 1, cAbw = cGes + 2;
  if (sh.getMaxColumns() < cAbw) sh.insertColumnsAfter(sh.getMaxColumns(), cAbw - sh.getMaxColumns());
  sh.getRange('A1').setValue('Bestand je Lager').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setValue('Nur Formeln – nicht von Hand bearbeiten. "Abweichung" muss überall 0 sein (sonst fehlt in einer Buchung das Lager).').setFontColor('#666666');
  var head = ['Item', 'SKU'].concat(lagers).concat(['Gesamt', 'Stock On Hand', 'Abweichung']);
  sh.getRange(LAGER_CFG.headerRow, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');

  // SUMIFS rechnet in ARRAYFORMULA nicht zeilenweise (die Artikel-Bedingung würde ignoriert).
  // Deshalb je Lager MAP/LAMBDA über die Artikelliste: jede Zeile wird einzeln summiert.
  var A = '$A$6:$A', IT = 'artikel', inv = function (c) { return 'Inventory!$' + c + '$6:$' + c; };
  var sum = function (sheet, qtyCol, itemCol, crit, lagerCol, X) {
    return 'SUMIFS(' + sheet + '!$' + qtyCol + '$6:$' + qtyCol + ',' + sheet + '!$' + itemCol + '$6:$' + itemCol + ',' + IT + ',' + crit + ',' + sheet + '!$' + lagerCol + '$6:$' + lagerCol + ',' + X + '$5)';
  };
  var f = [];
  f.push('=FILTER(' + inv(I.item) + ',' + inv(I.item) + '<>"")');
  f.push('=ARRAYFORMULA(IF(' + A + '="","",XLOOKUP(' + A + ',' + inv(I.item) + ',' + inv(I.sku) + ',"")))');
  lagers.forEach(function (_, i) {
    var X = LAGER_letter(3 + i);
    var cs = function (typeCell) { return sum('Correction', C.qty, C.item, 'Correction!$' + C.type + '$6:$' + C.type + ',' + typeCell, C.lager, X); };
    f.push('=MAP(FILTER(' + A + ',' + A + '<>""),LAMBDA(' + IT + ',' +
      sum('Purchases', P.qty, P.item, 'Purchases!$' + P.status + '$6:$' + P.status + ',"' + LAGER_CFG.received + '"', P.lager, X) +
      '-' + sum('Sales', S.qty, S.item, 'Sales!$' + S.status + '$6:$' + S.status + ',Setup!$G$11', S.lager, X) +
      '+' + cs(types.plus) + '-' + cs(types.minus) + '+' + cs(types.tplus) + '-' + cs(types.tminus) +
      '+IF(XLOOKUP(' + IT + ',' + inv(I.item) + ',' + inv(I.wh) + ',"")=' + X + '$5,N(XLOOKUP(' + IT + ',' + inv(I.item) + ',' + inv(I.init) + ',0))' +
      '+SUMIFS(Manufacture!$' + M.qty + '$6:$' + M.qty + ',Manufacture!$' + M.item + '$6:$' + M.item + ',' + IT + '),0)))');
  });
  var parts = lagers.map(function (_, i) { var X = LAGER_letter(3 + i); return X + '6:' + X; });
  f.push('=ARRAYFORMULA(IF(' + A + '="","",' + parts.join('+') + '))');
  f.push('=ARRAYFORMULA(IF(' + A + '="","",XLOOKUP(' + A + ',' + inv(I.item) + ',' + inv(I.soh) + ',0)))');
  var G = LAGER_letter(cGes), H = LAGER_letter(cSoh);
  f.push('=ARRAYFORMULA(IF(' + A + '="","",' + G + '6:' + G + '-' + H + '6:' + H + '))');
  sh.getRange(6, 1, 1, f.length).setFormulas([f.map(function (x) { return LAGER_loc(x, sep); })]);
  sh.getRange(6, 3, sh.getMaxRows() - 5, nL + 3).setNumberFormat('0');
  sh.setFrozenRows(LAGER_CFG.headerRow);
  sh.setColumnWidth(1, 300);
  var rule = SpreadsheetApp.newConditionalFormatRule().whenNumberNotEqualTo(0).setBackground('#fdecea').setFontColor('#b42318')
    .setRanges([sh.getRange(6, cAbw, sh.getMaxRows() - 5, 1)]).build();
  sh.setConditionalFormatRules([rule]);
}
