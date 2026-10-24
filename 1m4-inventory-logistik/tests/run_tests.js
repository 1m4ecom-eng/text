// Lokale Tests der reinen Logik: node tests/run_tests.js
const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '../logistik-buchung/Logistik_Logic.gs'));
const B = require(path.join(__dirname, '../sheetify-erweiterung/Bestand_Extern.gs'));

const today = new Date(2026, 9, 24, 15, 0);
const d = (y, m, dd) => new Date(y, m - 1, dd);
const lots = [
  { lot: 'A', rest: 10, expiry: d(2027, 6, 1), received: d(2026, 1, 1), blocked: false, row: 6 },
  { lot: 'B', rest: 5, expiry: d(2027, 1, 1), received: d(2026, 2, 1), blocked: false, row: 7 },
  { lot: 'G', rest: 50, expiry: d(2026, 12, 1), received: d(2026, 1, 1), blocked: true, row: 8 },  // gesperrt
  { lot: 'X', rest: 50, expiry: d(2026, 10, 23), received: d(2025, 1, 1), blocked: false, row: 9 }, // abgelaufen
  { lot: 'T', rest: 3, expiry: d(2026, 10, 24), received: d(2025, 1, 1), blocked: false, row: 10 }, // läuft heute ab = noch gültig
  { lot: 'N', rest: 4, expiry: null, received: d(2025, 6, 1), blocked: false, row: 11 }, // ohne Verfall = zuletzt
  { lot: 'Z', rest: 0, expiry: d(2026, 11, 1), received: d(2025, 1, 1), blocked: false, row: 12 } // aufgebraucht
];
const members = ['Helmut', 'Sabine', 'Doris', 'Sabina'];
const item = { lotRequired: true, stock: 100 };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('FEFO-Reihenfolge und Ausschluss gesperrt/abgelaufen/leer', () => {
  const s = L.LB_suggest(lots, 30, today);
  assert.deepStrictEqual(s.parts, [{ lot: 'T', qty: 3 }, { lot: 'B', qty: 5 }, { lot: 'A', qty: 10 }, { lot: 'N', qty: 4 }]);
  assert.strictEqual(s.missing, 8);
  assert.strictEqual(L.LB_formatLotText(s.parts, s.missing), 'T (3); B (5); A (10); N (4); OHNE LOT (8)');
});

t('LOT-Text kompatibel mit Formel-Regex in LOTs!J', () => {
  const re = /^(.*) \((\d+)\)$/;
  L.LB_formatLotText([{ lot: '262006', qty: 2 }], 0).split('; ').forEach(x => assert.ok(re.test(x)));
});

t('Ausgang ohne LS-Nr. wird blockiert', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lsNo: '  ', qty: 2, parts: null }, { members, item, lots, today });
  assert.ok(v.errors.some(e => e.includes('Lieferscheinnummer')));
});

t('Ausgang FEFO-Vorschlag ohne Warnung', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lsNo: 'LS-1', qty: 4, parts: null }, { members, item, lots, today });
  assert.deepStrictEqual(v.errors, []); assert.deepStrictEqual(v.warnings, []);
  assert.strictEqual(v.lotText, 'T (3); B (1)');
});

t('Ausgang über Bestand -> Warnung', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lsNo: 'LS-1', qty: 150, parts: null }, { members, item, lots, today });
  assert.deepStrictEqual(v.errors, []);
  assert.ok(v.warnings.some(w => w.includes('Stock on Hand')));
  assert.ok(v.warnings.some(w => w.includes('OHNE LOT')));
});

t('Ausgang manuelle LOT über Restbestand -> Warnung', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lsNo: 'LS-1', qty: 7, parts: [{ lot: 'B', qty: 7 }] }, { members, item, lots, today });
  assert.deepStrictEqual(v.errors, []);
  assert.ok(v.warnings.some(w => w.includes('Restbestand der LOT "B"')));
  assert.strictEqual(v.lotText, 'B (7)');
});

t('Gesperrte und abgelaufene LOT nicht wählbar', () => {
  const g = L.LB_validateShipment({ member: 'Doris', lsNo: 'LS', qty: 1, parts: [{ lot: 'G', qty: 1 }] }, { members, item, lots, today });
  assert.ok(g.errors.some(e => e.includes('gesperrt')));
  const x = L.LB_validateShipment({ member: 'Doris', lsNo: 'LS', qty: 1, parts: [{ lot: 'X', qty: 1 }] }, { members, item, lots, today });
  assert.ok(x.errors.some(e => e.includes('abgelaufen')));
  assert.ok(!L.LB_isSelectable(lots[2], today) && !L.LB_isSelectable(lots[3], today) && L.LB_isSelectable(lots[4], today));
});

t('LOT-Mengen größer als Buchungsmenge -> Fehler', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lsNo: 'LS', qty: 2, parts: [{ lot: 'A', qty: 3 }] }, { members, item, lots, today });
  assert.ok(v.errors.some(e => e.includes('größer als die Buchungsmenge')));
});

t('Artikel ohne LOT-Pflicht und ohne LOTs: kein LOT-Text, keine Warnung', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lsNo: 'LS', qty: 2, parts: null }, { members, item: { lotRequired: false, stock: 10 }, lots: [], today });
  assert.deepStrictEqual(v.warnings, []); assert.strictEqual(v.lotText, '');
});

t('Pflichtfelder / Mitarbeiter / Menge', () => {
  const v = L.LB_validateShipment({ member: 'Max', lsNo: 'LS', qty: 1.5, parts: null }, { members, item, lots, today });
  assert.ok(v.errors.some(e => e.includes('Mitarbeiter')));
  assert.ok(v.errors.some(e => e.includes('ganze Zahl')));
});

t('Eingang neue LOT ok, LOT-Pflicht', () => {
  const ok = L.LB_validateReceipt({ member: 'Helmut', qty: 20, lot: 'NEU-1', expiry: d(2028, 1, 1) }, { members, item, lots, today });
  assert.deepStrictEqual(ok.errors, []); assert.deepStrictEqual(ok.warnings, []); assert.strictEqual(ok.existingLot, null);
  const miss = L.LB_validateReceipt({ member: 'Helmut', qty: 20, lot: '' }, { members, item, lots, today });
  assert.ok(miss.errors.some(e => e.includes('Pflicht')));
  const free = L.LB_validateReceipt({ member: 'Helmut', qty: 20, lot: '' }, { members, item: { lotRequired: false }, lots, today });
  assert.deepStrictEqual(free.errors, []);
});

t('Eingang vorhandene LOT -> Rückfrage, keine Doppelanlage', () => {
  const v = L.LB_validateReceipt({ member: 'Helmut', qty: 20, lot: ' a ', expiry: null }, { members, item, lots: [{ ...lots[0], lot: 'a' }], today });
  assert.deepStrictEqual(v.errors, []);
  assert.ok(v.existingLot && v.warnings[0].includes('existiert'));
  const e = L.LB_validateReceipt({ member: 'Helmut', qty: 20, lot: 'A', expiry: d(2030, 1, 1) }, { members, item, lots, today });
  assert.ok(e.warnings.some(w => w.includes('Verfallsdatum weicht')));
});

t('Eingang: ungültige LOT-Zeichen und OHNE LOT', () => {
  assert.ok(L.LB_validateReceipt({ member: 'Helmut', qty: 1, lot: 'A (2)' }, { members, item, lots, today }).errors.length);
  assert.ok(L.LB_validateReceipt({ member: 'Helmut', qty: 1, lot: 'ohne lot' }, { members, item, lots, today }).errors.length);
});

const types = [{ name: '  📋 Inventory Correction (+)', sign: 1 }, { name: '  📋 Inventory Correction (−)', sign: -1 }];
t('Korrektur + und −, Begründung Pflicht', () => {
  const p = L.LB_validateCorrection({ member: 'Sabina', type: '  📋 Inventory Correction (+)', qty: 5, lot: 'G', notes: 'Zählung' }, { members, types, item, lots, today });
  assert.deepStrictEqual(p.errors, []); assert.strictEqual(p.sign, 1); assert.strictEqual(p.typeName, types[0].name);
  const m = L.LB_validateCorrection({ member: 'Sabina', type: types[1].name, qty: 6, lot: 'B', notes: 'Bruch' }, { members, types, item, lots, today });
  assert.ok(m.warnings.some(w => w.includes('Restbestand der LOT "B"')));
  const no = L.LB_validateCorrection({ member: 'Sabina', type: types[1].name, qty: 1, lot: 'B', notes: ' ' }, { members, types, item, lots, today });
  assert.ok(no.errors.some(e => e.includes('Begründung')));
  const bad = L.LB_validateCorrection({ member: 'Sabina', type: types[1].name, qty: 1, lot: 'QQ', notes: 'x' }, { members, types, item, lots, today });
  assert.ok(bad.errors.some(e => e.includes('gehört nicht')));
});

t('Externer Filter laut Freigabe', () => {
  const inc = s => B.BE_isIncluded({ type: 'Product', sku: s });
  assert.ok(inc('10000.00') && inc('13015.09') && inc('21000.01') && inc('9783956581168'));
  assert.ok(!inc('80000.00') && !inc('80003.02') && !inc('EH 157') && !inc('EH 193') && !inc('12000.99'));
  assert.ok(!B.BE_isIncluded({ type: 'Material', sku: '21001.01' }));
});

t('Externer Bestand ohne gesperrte/abgelaufene LOTs, min. 0, EAN n/a leer', () => {
  const inv = [
    { item: 'P1', sku: '10000.00', ean: '4745010564024', type: 'Product', stock: 100 },
    { item: 'P2', sku: '12001.01', ean: 'n/a', type: 'Product', stock: 5 },
    { item: 'M1', sku: '80004.01', ean: 'n/a', type: 'Material', stock: 9 }
  ];
  const ls = [
    { item: 'P1', rest: 30, blocked: true, expiry: null },
    { item: 'P1', rest: 10, blocked: false, expiry: d(2026, 1, 1) },
    { item: 'P1', rest: 40, blocked: false, expiry: d(2027, 1, 1) },
    { item: 'P2', rest: 9, blocked: true, expiry: null }
  ];
  assert.deepStrictEqual(B.BE_buildRows(inv, ls, today), [['10000.00', '4745010564024', 'P1', 60], ['12001.01', '', 'P2', 0]]);
});

console.log('\n' + n + ' Tests bestanden');
