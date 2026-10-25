// LAGER_setup gegen eine Tabelle im Speicher; prüft erzeugte Spalten, Typen und Formeln: node tests/lager_setup_mock_test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
// Deutsches Gebietsschema nachbilden: "," außerhalb von Textliteralen = Parse-Fehler
const hasComma = f => { let q = false; for (const ch of f) { if (ch === '"') q = !q; else if (!q && ch === ',') return true; } return false; };
const de = x => { let q = false, o = ''; for (const ch of x) { if (ch === '"') q = !q; o += (!q && ch === ',') ? ';' : ch; } return o; };
const chain = new Proxy({}, { get: (o, k) => k === 'build' ? () => ({}) : () => chain });
class Sheet {
  constructor(name, rows, cols) { Object.assign(this, { name, v: {}, f: {}, maxR: rows, maxC: cols, dv: {} }); }
  k(r, c) { return r + ',' + c; }
  cell(r, c) { return this.v[this.k(r, c)]; }
  set(r, c, x) { this.v[this.k(r, c)] = x; }
  getName() { return this.name; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      const r0 = +m[2], c0 = colNum(m[1]), r1 = m[3] ? +m[4] : r0, c1 = m[3] ? colNum(m[3]) : c0;
      return new Range(this, r0, c0, r1 - r0 + 1, c1 - c0 + 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getLastColumn() { let l = 0; Object.keys(this.v).forEach(k => { if (this.v[k] !== '' && this.v[k] !== undefined) l = Math.max(l, +k.split(',')[1]); }); return l; }
  getMaxRows() { return this.maxR; } getMaxColumns() { return this.maxC; }
  insertColumnAfter() { this.maxC++; } insertColumnsAfter(_, n) { this.maxC += n; }
  clear() { this.v = {}; this.f = {}; } setFrozenRows() {} setColumnWidth() {} setConditionalFormatRules() {}
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const x = this.sh.cell(this.r + i, this.c + j); row.push(x === undefined ? '' : x); } o.push(row); } return o; }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  setValues(a) { a.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setFormulas(a) { assert.strictEqual(a.length, this.nr, 'Formel-Array passt nicht zum Bereich ' + this.sh.name); a.forEach((row, i) => row.forEach((x, j) => { this.sh.f[(this.r + i) + ',' + (this.c + j)] = x; })); return this; }
  setFormula(x) { this.sh.f[this.r + ',' + this.c] = x; return this; }
  getValue() { const f = this.sh.f[this.r + ',' + this.c]; if (f) return hasComma(f) ? '#ERROR!' : 1; const x = this.sh.cell(this.r, this.c); return x === undefined ? '' : x; }
  setDataValidation(x) { this.sh.dv[this.c] = (this.sh.dv[this.c] || 0) + 1; return this; }
  copyTo() {} setNumberFormat() { return this; } setFontSize() { return this; } setFontWeight() { return this; } setFontColor() { return this; } setBackground() { return this; }
}
const sheets = {};
const add = (n, r, c) => (sheets[n] = new Sheet(n, r, c));
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => add(n, 1000, 8), deleteSheet: sh => { delete sheets[sh.name]; }, toast() {} };
const H = 5, head = (sh, cols) => Object.entries(cols).forEach(([L, t]) => sh.set(H, colNum(L), t));
const setup = add('Setup', 466, 36);
setup.set(6, colNum('N'), 'Team Member'); setup.set(26, colNum('N'), 'Warehouse'); ['Medi-Learn', 'Medichem', 'Medbuy'].forEach((m, i) => setup.set(27 + i, colNum('N'), m));
setup.set(41, 2, 'Correction Type'); setup.set(41, 3, 'Sign'); setup.set(43, 2, '  📋 Inventory Correction (+)'); setup.set(43, 3, 1); setup.set(44, 2, '  📋 Inventory Correction (−)'); setup.set(44, 3, -1);
head(add('Inventory', 1004, 31), { B: 'Item', C: 'SKU', D: 'EAN', H: 'Type', I: 'Warehouse', J: 'Initial\nStock', K: 'Stock\nOn Hand', Z: 'LOT-Pflicht' });
head(add('LOTs', 1000, 16), { B: 'Eingangsdatum', C: 'Item', D: 'SKU', E: 'LOT', F: 'Verfallsdatum', G: 'Menge Eingang', H: 'Quelle / Referenz', I: 'Sperre', J: 'Ausgang Verkauf', K: 'Korrektur (+/−)', L: 'Restbestand', M: 'Status', N: 'Nächste', O: 'Notizen' });
head(add('Sales', 1044, 31), { B: 'Order Date', C: 'Created By', D: 'LS No.', E: 'Item', F: 'SKU', G: 'QTY', H: 'Stock on Hand', I: 'Status', J: 'Sale Price', K: 'Sale Profit', L: 'Assigned To', M: 'Notes', N: 'LOT' });
head(add('Purchases', 1038, 28), { B: 'Order Date', C: 'Created By', D: 'Recieved Date', E: 'ID', F: 'Item', G: 'SKU', H: 'Purchase QTY', I: 'Recieved QTY', J: 'Difference', K: 'Unit Cost', L: 'Total Cost', M: 'Status', N: 'Vendor', O: 'Shipping Days', P: 'Assigned To', Q: 'Notes' });
head(add('Correction', 1041, 31), { B: 'Date', C: 'Created By', E: 'Item', F: 'SKU', G: 'Quantity', H: 'Stock on Hand', I: 'Type', L: 'Assigned To', M: 'Notes', N: 'LOT' });
head(add('Manufacture', 1071, 26), { B: 'Date', C: 'Batch No', D: 'Item', E: 'SKU', F: 'QTY', G: 'Notes' });

const ctx = { console, Math, String, Number, Object, Array, Error, JSON,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {}, CopyPasteType: {}, newDataValidation: () => chain, newConditionalFormatRule: () => chain },
  Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../sheetify-erweiterung/Lager_Setup.gs'), 'utf8'), ctx);
vm.runInContext('LAGER_setup()', ctx);
vm.runInContext('LAGER_setup()', ctx); // zweiter Lauf: wiederholbar

const balanced = f => { let d = 0, q = false; for (const ch of f) { if (ch === '"') q = !q; else if (!q) { if (ch === '(') d++; if (ch === ')') d--; if (d < 0) return false; } } return d === 0 && !q; };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('Spalte "Lager" am rechten Rand (Sales O, Purchases R, Correction O, LOTs P), einmalig', () => {
  assert.strictEqual(sheets.Sales.cell(5, colNum('O')), 'Lager'); assert.strictEqual(sheets.Purchases.cell(5, colNum('R')), 'Lager');
  assert.strictEqual(sheets.Correction.cell(5, colNum('O')), 'Lager'); assert.strictEqual(sheets.LOTs.cell(5, colNum('P')), 'Lager');
  assert.strictEqual(sheets.Sales.cell(5, colNum('P')), undefined, 'kein Duplikat beim zweiten Lauf');
});
t('Umlagerungstypen in Setup B45/B46, einmalig', () => {
  assert.strictEqual(setup.cell(45, 2), '  🔁 Umlagerung (+)'); assert.strictEqual(setup.cell(45, 3), 1);
  assert.strictEqual(setup.cell(46, 2), '  🔁 Umlagerung (−)'); assert.strictEqual(setup.cell(46, 3), -1);
  assert.strictEqual(setup.cell(47, 2), undefined);
});
const L = sheets.LOTs.f, j6 = L['6,10'], k6 = L['6,11'], n6 = L['6,14'], n1000 = L['1000,14'];
t('LOT-Formeln: Klammern, Lager-Bedingung, Zeilenbezug', () => {
  [j6, k6, n6].forEach(f => assert.ok(balanced(f), f));
  assert.ok(j6.includes('Sales!$O$6:$O=P6') && j6.includes('Sales!$I$6:$I=Setup!$G$11') && j6.includes('"^(.*) \\(\\d+\\)$"') && j6.includes(';"; ";FALSE)'), j6);
  assert.ok(k6.includes('Correction!$O$6:$O=P6') && k6.includes(de('VLOOKUP(Correction!$I$6:$I,Setup!$B$42:$C$56,2,FALSE)')), k6);
  assert.ok(n6.includes('($P$6:$P=P6)') && n1000.includes('=P1000'), n1000);
  assert.ok(!/[{}#]/.test(j6 + k6 + n6), 'keine offenen Platzhalter');
});
const st = sheets['Bestand je Lager'];
t('Tab "Bestand je Lager": Kopf + Formeln', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8].map(c => st.cell(5, c)), ['Item', 'SKU', 'Medi-Learn', 'Medichem', 'Medbuy', 'Gesamt', 'Stock On Hand', 'Abweichung']);
  const f = c => st.f['6,' + c];
  for (let c = 1; c <= 8; c++) assert.ok(balanced(f(c)), f(c));
  assert.strictEqual(f(1), '=FILTER(Inventory!$B$6:$B;Inventory!$B$6:$B<>"")');
  const c3 = f(3);
  ['Purchases!$R$6:$R,C$5', 'Purchases!$M$6:$M,"✅ Received"', 'Sales!$O$6:$O,C$5', 'Correction!$I$6:$I,Setup!$B$45', 'Correction!$I$6:$I,Setup!$B$46',
    'Inventory!$I$6:$I,"")=C$5', 'Inventory!$J$6:$J,0)', 'Manufacture!$F$6:$F,Manufacture!$D$6:$D'].map(de).forEach(x => assert.ok(c3.includes(x), x + ' fehlt in ' + c3));
  assert.ok(f(4).includes('D$5') && f(6).includes('C6:C+D6:D+E6:E') && f(7).includes('Inventory!$K$6:$K') && f(8).includes('F6:F-G6:G'));
});
t('Deutsches Gebietsschema: alle Formeln mit ";" (Textliterale unverändert), Prüfblatt gelöscht', () => {
  const all = Object.values(sheets.LOTs.f).concat(Object.values(st.f));
  assert.ok(all.length > 2000);
  all.forEach(f => assert.ok(!hasComma(f), 'Komma in ' + f));
  assert.ok(!Object.keys(sheets).some(k => k.startsWith('_lager_probe_')));
});
console.log('\nBeispiel K6: ' + k6 + '\n\nBeispiel Medi-Learn: ' + st.f['6,3']);
console.log('\n' + n + ' Setup-Prüfungen bestanden');
