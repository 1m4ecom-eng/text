// Durchstich der Serverfunktionen gegen eine Tabelle im Speicher: node tests/server_mock_test.js
// Formeln werden nicht berechnet; Formelzellen bekommen vorgegebene Werte (z. B. Restbestand).
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

/* ---------- Mini-Mock der Spreadsheet-API ---------- */
function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
class Sheet {
  constructor(name, rows = 40, cols = 31) { this.name = name; this.v = []; this.f = []; this.maxR = rows; this.maxC = cols; this.hidden = {}; }
  cell(r, c) { return (this.v[r - 1] || [])[c - 1]; }
  set(r, c, val) { (this.v[r - 1] = this.v[r - 1] || [])[c - 1] = val; }
  setF(r, c, f) { (this.f[r - 1] = this.f[r - 1] || [])[c - 1] = f; }
  getF(r, c) { return (this.f[r - 1] || [])[c - 1] || ''; }
  getName() { return this.name; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const m = a.match(/^([A-Z]+)(\d+)$/); return new Range(this, +m[2], colNum(m[1]), 1, 1); }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getLastRow() { let last = 0; for (let r = 1; r <= this.maxR; r++) for (let c = 1; c <= this.maxC; c++) { const x = this.cell(r, c); if ((x !== undefined && x !== '') || this.getF(r, c)) last = r; } return last; }
  getLastColumn() { let last = 0; for (let r = 1; r <= this.maxR; r++) for (let c = 1; c <= this.maxC; c++) { const x = this.cell(r, c); if ((x !== undefined && x !== '') || this.getF(r, c)) last = Math.max(last, c); } return last; }
  getMaxRows() { return this.maxR; } getMaxColumns() { return this.maxC; }
  insertRowBefore(r) { this.v.splice(r - 1, 0, []); this.f.splice(r - 1, 0, []); this.maxR++; }
  isRowHiddenByUser(r) { return !!this.hidden[r]; } showRows(r) { delete this.hidden[r]; }
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((x, i) => this.set(r, i + 1, x)); }
  setFrozenRows() {}
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  map(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i, this.c + j)); out.push(row); } return out; }
  getValues() { return this.map((r, c) => { const x = this.sh.cell(r, c); return x === undefined ? '' : x; }); }
  getDisplayValues() { return this.getValues().map(row => row.map(x => x instanceof Date ? x.toISOString().slice(0, 10) : String(x))); }
  getValue() { return this.getValues()[0][0]; }
  getFormulas() { return this.map((r, c) => this.sh.getF(r, c)); }
  getFormulasR1C1() { return this.getFormulas(); }
  getFormula() { return this.sh.getF(this.r, this.c); }
  setValue(x) { this.sh.set(this.r, this.c, x); this.sh.setF(this.r, this.c, ''); return this; }
  setValues(a) { a.forEach((row, i) => row.forEach((x, j) => { this.sh.set(this.r + i, this.c + j, x); this.sh.setF(this.r + i, this.c + j, ''); })); return this; }
  setFormulaR1C1(f) { this.sh.setF(this.r, this.c, f); return this; }
  copyTo() {}
  setFontWeight() { return this; }
}
class SS {
  constructor() { this.sheets = {}; }
  add(name, rows, cols) { return (this.sheets[name] = new Sheet(name, rows, cols)); }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return this.add(n, 100, 26); }
}

/* ---------- Testtabelle ---------- */
function build() {
  const ss = new SS(), H = 5;
  const head = (sh, cols) => Object.entries(cols).forEach(([L, t]) => sh.set(H, colNum(L), t));
  const setup = ss.add('Setup', 120, 36);
  setup.set(6, colNum('N'), 'Team Member'); ['Helmut', 'Sabine', 'Doris', 'Sabina'].forEach((m, i) => setup.set(7 + i, colNum('N'), m));
  setup.set(26, colNum('N'), 'Warehouse'); ['Medi-Learn', 'Medichem', 'Medbuy'].forEach((m, i) => setup.set(27 + i, colNum('N'), m));
  setup.set(41, 2, 'Correction Type'); setup.set(41, 3, 'Sign');
  [['  📋 Inventory Correction (+)', 1], ['  📋 Inventory Correction (−)', -1], ['  🔁 Umlagerung (+)', 1], ['  🔁 Umlagerung (−)', -1]]
    .forEach(([n, s], i) => { setup.set(43 + i, 2, n); setup.set(43 + i, 3, s); });
  setup.set(11, colNum('G'), '🚚 Shipped');

  const inv = ss.add('Inventory', 40, 31);
  head(inv, { B: 'Item', C: 'SKU', D: 'EAN', G: 'Catagory', H: 'Type', I: 'Warehouse', J: 'Initial\nStock', K: 'Stock\nOn Hand', N: 'Sales Price\nPer Unit', R: 'Preferred Vendor', Z: 'LOT-Pflicht' });
  [['1m4 Keyboard Cover', '10000.00', 4745010564024, 'Product', 'Medi-Learn', 100, 185, 1.77, 'Fully Care'],
   ['Rezepte', '80009.01', 'n/a', 'Material', 'Medi-Learn', 0, 0, 0, '']].forEach((x, i) => {
    const r = 7 + i; ['B', 'C', 'D', 'H', 'I', 'J', 'K', 'N', 'R'].forEach((L, j) => inv.set(r, colNum(L), x[j])); inv.setF(r, colNum('K'), '=SOH');
  });

  const lots = ss.add('LOTs', 20, 16);
  head(lots, { B: 'Eingangsdatum', C: 'Item', D: 'SKU', E: 'LOT', F: 'Verfallsdatum', G: 'Menge Eingang', H: 'Quelle / Referenz', I: 'Sperre', J: 'Ausgang Verkauf', K: 'Korrektur (+/−)', L: 'Restbestand', M: 'Status', N: 'Nächste', O: 'Notizen', P: 'Lager' });
  lots.set(3, colNum('M'), 90);
  for (let r = 6; r <= 20; r++) ['D', 'J', 'K', 'L', 'M', 'N'].forEach(L => lots.setF(r, colNum(L), '=F'));
  const lot = (r, item, l, exp, qty, lock, rest, lager) => { [['B', new Date(2026, 0, 1)], ['C', item], ['E', l], ['F', exp], ['G', qty], ['I', lock], ['L', rest], ['P', lager]].forEach(([L, x]) => lots.set(r, colNum(L), x)); };
  lot(6, '1m4 Keyboard Cover', '1234', '', 100, '', 97, 'Medi-Learn');
  lot(7, '1m4 Keyboard Cover', 'T-FREI', new Date(2028, 9, 24), 60, 'Frei', 50, 'Medi-Learn');
  lot(8, '1m4 Keyboard Cover', 'T-GESP', new Date(2027, 0, 1), 15, 'Gesperrt', 15, 'Medi-Learn');

  const withRows = (name, cols, formulaCols) => {
    const sh = ss.add(name, 30, 31); head(sh, cols); sh.hidden[6] = true;
    for (let r = 6; r <= 10; r++) formulaCols.forEach(L => sh.setF(r, colNum(L), '=F' + L));
    return sh;
  };
  withRows('Sales', { B: 'Order Date', C: 'Created By', D: 'LS No.', E: 'Item', F: 'SKU', G: 'QTY', H: 'Stock on Hand', I: 'Status', J: 'Sale Price', K: 'Sale Profit', L: 'Assigned To', M: 'Notes', N: 'LOT', O: 'Lager' }, ['F', 'H', 'J', 'K']);
  withRows('Purchases', { B: 'Order Date', C: 'Created By', D: 'Recieved Date', E: 'ID', F: 'Item', G: 'SKU', H: 'Purchase QTY', I: 'Recieved QTY', J: 'Difference', K: 'Unit Cost', L: 'Total Cost', M: 'Status', N: 'Vendor', O: 'Shipping Days', P: 'Assigned To', Q: 'Notes', R: 'Lager' }, ['G', 'J', 'L', 'O']);
  withRows('Correction', { B: 'Date', C: 'Created By', E: 'Item', F: 'SKU', G: 'Quantity', H: 'Stock on Hand', I: 'Type', L: 'Assigned To', M: 'Notes', N: 'LOT', O: 'Lager' }, ['F', 'H']);
  const ven = ss.add('Vendors', 20, 26); ven.set(6, 2, 'Fully Care'); ven.set(7, 2, '1M4 OÜ');
  const st = ss.add('Bestand je Lager', 20, 10);
  head(st, { A: 'Item', B: 'SKU', C: 'Medi-Learn', D: 'Medichem', E: 'Medbuy', F: 'Gesamt', G: 'Stock On Hand', H: 'Abweichung' });
  [['1m4 Keyboard Cover', '10000.00', 185, 0, 0, 185, 185, 0], ['Rezepte', '80009.01', 0, 0, 0, 0, 0, 0]].forEach((x, i) => x.forEach((v, j) => st.set(6 + i, j + 1, v)));
  const log = ss.add('Buchungslog', 100, 26);
  ['Zeitstempel', 'Buchungs-ID', 'Mitarbeiter', 'Google-Konto', 'Art', 'SKU', 'Artikel', 'Menge', 'LOT', 'LS-Nr.', 'Zieltab', 'Zeile', 'Hinweise'].forEach((h, i) => log.set(1, i + 1, h));
  return ss;
}

/* ---------- Apps-Script-Globale ---------- */
const ss = build();
let user = 'logistik@medi-learn.de';
const props = { SPREADSHEET_ID: 'x', ALLOWED_EMAILS: 'logistik@medi-learn.de', VIEW_EMAILS: 'leser@example.com', ADMIN_EMAILS: '1m4.ecom@gmail.com',
  ADMIN_LINKS: 'Tabelle | https://docs.google.com/x; kaputt | http://unsicher' };
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, isNaN, isFinite, RegExp, Error,
  SpreadsheetApp: { openById: () => ss, flush() {}, CopyPasteType: { PASTE_FORMAT: 1, PASTE_DATA_VALIDATION: 2 } },
  Session: { getActiveUser: () => ({ getEmail: () => user }), getScriptTimeZone: () => 'Europe/Helsinki' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 19) },
  HtmlService: {}
};
vm.createContext(ctx);
['Logistik_Logic.gs', 'Logistik_Server.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../logistik-buchung', f), 'utf8'), ctx));
const run = (code) => { const r = vm.runInContext(code, ctx); return r === undefined ? r : JSON.parse(JSON.stringify(r)); };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const S = ss.sheets;
const col = (sh, L) => colNum(L);

t('Rollen: Leser, Buchen, Admin, Fremder', () => {
  user = 'leser@example.com'; assert.strictEqual(run('LB_roleOf(LB_userEmail())'), 'view');
  assert.throws(() => run('bookReceipt({})'), /Keine Berechtigung/);
  assert.throws(() => run('getItemDetails("1m4 Keyboard Cover","Medi-Learn")'), /Keine Berechtigung/);
  const d = run('getInitData()'); assert.strictEqual(d.members.length, 0); assert.strictEqual(d.links.length, 0);
  user = 'fremd@example.com'; assert.throws(() => run('getInitData()'), /Kein Zugriff/);
  user = '1m4.ecom@gmail.com'; const a = run('getInitData()');
  assert.strictEqual(a.role, 'admin'); assert.deepStrictEqual(a.links, [{ label: 'Tabelle', url: 'https://docs.google.com/x' }]);
  assert.deepStrictEqual(a.lagers, ['Medi-Learn', 'Medichem', 'Medbuy']); assert.strictEqual(a.transferReady, true);
  assert.strictEqual(a.types.length, 2, 'Umlagerung nicht in Korrekturtypen');
  assert.ok(!JSON.stringify(a.items).includes('1.77'), 'keine Preise');
  user = 'logistik@medi-learn.de'; assert.strictEqual(run('getInitData()').role, 'book');
});

t('Bestandsansicht: Lager + LOT-Zustände, keine Preise', () => {
  user = 'leser@example.com';
  const o = run('getStockOverview()');
  const kc = o.items.find(i => i.item === '1m4 Keyboard Cover');
  assert.deepStrictEqual(kc.byLager, { 'Medi-Learn': 185, Medichem: 0, Medbuy: 0 }); assert.strictEqual(kc.total, 185);
  assert.deepStrictEqual(kc.lots.map(l => [l.lot, l.state]), [['T-GESP', 'gesperrt'], ['T-FREI', 'frei'], ['1234', 'frei']]);
  assert.ok(!JSON.stringify(o).includes('1.77'));
});

t('Wareneingang Medbuy mit LOT 1234: neue LOT-Zeile im Lager Medbuy, Purchases mit Lager', () => {
  user = 'logistik@medi-learn.de';
  const r = run('bookReceipt({member:"Helmut", lager:"Medbuy", item:"1m4 Keyboard Cover", qty:20, lot:"1234", expiry:"2028-01-31", vendor:"Fully Care", ref:"PO-9", notes:""})');
  assert.ok(r.ok, JSON.stringify(r));
  const L = S.LOTs; assert.strictEqual(L.cell(9, colNum('E')), '1234'); assert.strictEqual(L.cell(9, colNum('P')), 'Medbuy'); assert.strictEqual(L.cell(9, colNum('I')), 'Gesperrt');
  const P = S.Purchases; assert.strictEqual(P.cell(7, colNum('R')), 'Medbuy'); assert.strictEqual(P.cell(7, colNum('M')), '✅ Received');
  assert.strictEqual(P.getF(7, colNum('G')), '=FG', 'Formel aus der Zeile darunter übernommen');
  assert.strictEqual(S.Buchungslog.cell(1, 14), 'Lager', 'Log-Kopf ergänzt');
  assert.strictEqual(S.Buchungslog.cell(2, 14), 'Medbuy');
});

t('Wareneingang gleiche LOT im gleichen Lager: Rückfrage, dann Aufstockung', () => {
  const q = run('bookReceipt({member:"Helmut", lager:"Medi-Learn", item:"1m4 Keyboard Cover", qty:5, lot:"T-FREI"})');
  assert.ok(q.needsConfirm && q.warnings[0].includes('existiert'));
  const r = run('bookReceipt({member:"Helmut", lager:"Medi-Learn", item:"1m4 Keyboard Cover", qty:5, lot:"T-FREI", confirm:true})');
  assert.ok(r.ok); assert.strictEqual(S.LOTs.cell(7, colNum('G')), 65);
});

t('Warenausgang: FEFO aus Lager, LS Pflicht, Lager in Sales', () => {
  const no = run('bookShipment({member:"Doris", lager:"Medi-Learn", item:"1m4 Keyboard Cover", qty:3, lsNo:""})');
  assert.ok(no.errors.some(e => e.includes('Lieferschein')));
  const p = run('previewShipment({member:"Doris", lager:"Medi-Learn", item:"1m4 Keyboard Cover", qty:3})');
  assert.deepStrictEqual(p.errors, []); assert.deepStrictEqual(p.suggestion.parts, [{ lot: 'T-FREI', qty: 3 }]);
  const r = run('bookShipment({member:"Doris", lager:"Medi-Learn", item:"1m4 Keyboard Cover", qty:3, lsNo:"LS-1", parts:[]})');
  assert.ok(r.ok, JSON.stringify(r));
  const s = S.Sales; assert.strictEqual(s.cell(7, colNum('N')), 'T-FREI (3)'); assert.strictEqual(s.cell(7, colNum('O')), 'Medi-Learn'); assert.strictEqual(s.cell(7, colNum('I')), '🚚 Shipped');
  const w = run('previewShipment({member:"Doris", lager:"Medichem", item:"1m4 Keyboard Cover", qty:3})');
  assert.ok(w.warnings.some(x => x.includes('Bestand im Lager (0)')), 'Lagerbestand Medichem 0');
});

t('Korrektur mit Lager', () => {
  const r = run('bookCorrection({member:"Sabina", lager:"Medi-Learn", item:"1m4 Keyboard Cover", qty:2, type:"  📋 Inventory Correction (−)", lot:"1234", notes:"Bruch"})');
  assert.ok(r.ok, JSON.stringify(r)); const c = S.Correction;
  assert.strictEqual(c.cell(7, colNum('O')), 'Medi-Learn'); assert.strictEqual(c.cell(7, colNum('I')), '  📋 Inventory Correction (−)');
  const u = run('bookCorrection({member:"Sabina", lager:"Medi-Learn", item:"1m4 Keyboard Cover", qty:2, type:"  🔁 Umlagerung (−)", notes:"x"})');
  assert.ok(u.errors.length, 'Umlagerungstyp nicht als Korrektur wählbar');
});

t('Umlagerung Medi-Learn → Medichem: 2 Correction-Zeilen, neue LOT-Zeile im Ziellager mit Sperre/Verfall', () => {
  const r = run('bookTransfer({member:"Doris", from:"Medi-Learn", to:"Medichem", item:"1m4 Keyboard Cover", qty:5, parts:[{lot:"T-GESP", qty:5}], lsNo:"", notes:"Test", confirm:true})');
  assert.ok(r.ok, JSON.stringify(r));
  const c = S.Correction;
  assert.strictEqual(c.cell(7, colNum('I')), '  🔁 Umlagerung (+)'); assert.strictEqual(c.cell(7, colNum('O')), 'Medichem');
  assert.strictEqual(c.cell(8, colNum('I')), '  🔁 Umlagerung (−)'); assert.strictEqual(c.cell(8, colNum('O')), 'Medi-Learn');
  assert.strictEqual(c.cell(7, colNum('N')), 'T-GESP'); assert.strictEqual(c.cell(7, colNum('G')), 5);
  const L = S.LOTs; assert.strictEqual(L.cell(10, colNum('E')), 'T-GESP'); assert.strictEqual(L.cell(10, colNum('P')), 'Medichem');
  assert.strictEqual(L.cell(10, colNum('I')), 'Gesperrt'); assert.strictEqual(L.cell(10, colNum('G')), 0);
  assert.strictEqual(+L.cell(10, colNum('F')), +new Date(2027, 0, 1));
  const warn = run('bookTransfer({member:"Doris", from:"Medi-Learn", to:"Medichem", item:"1m4 Keyboard Cover", qty:5, parts:[{lot:"T-GESP", qty:5}]})');
  assert.ok(warn.needsConfirm && warn.warnings.some(w => w.includes('gesperrt')));
  const bad = run('bookTransfer({member:"Doris", from:"Medi-Learn", to:"Medi-Learn", item:"1m4 Keyboard Cover", qty:1})');
  assert.ok(bad.errors.some(e => e.includes('verschieden')));
});

t('Buchungslog: neueste zuerst, mit Lager', () => {
  user = 'leser@example.com';
  const l = run('getLog()');
  assert.strictEqual(l[0].kind, 'Umlagerung'); assert.strictEqual(l[0].lager, 'Medi-Learn → Medichem');
  assert.ok(l.length >= 5);
});

console.log('\n' + n + ' Server-Durchstiche bestanden');
