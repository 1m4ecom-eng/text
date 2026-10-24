// Lokale Tests der reinen Logik: node tests/run_tests.js
const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '../logistik-buchung/Logistik_Logic.gs'));
const B = require(path.join(__dirname, '../sheetify-erweiterung/Bestand_Extern.gs'));
const MIG = require(path.join(__dirname, '../sheetify-erweiterung/Lager_Migration.gs'));

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
  assert.ok(v.warnings.some(w => w.includes('Bestand im Lager')));
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
  assert.ok(bad.errors.some(e => e.includes('in diesem Lager nicht')));
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


/* ---------- Phase 3: Lager, Umlagerung, Bestandsansicht, Migration ---------- */
const lagers = ['Medi-Learn', 'Medichem', 'Medbuy'];
const mlots = [
  { lot: 'L1', lager: 'Medi-Learn', rest: 10, expiry: d(2027, 1, 1), received: d(2026, 1, 1), blocked: false, row: 6 },
  { lot: 'L1', lager: 'Medbuy', rest: 4, expiry: d(2027, 1, 1), received: d(2026, 1, 1), blocked: false, row: 7 },
  { lot: 'L0', lager: 'Medbuy', rest: 2, expiry: d(2026, 12, 1), received: d(2026, 1, 1), blocked: false, row: 8 },
  { lot: 'LG', lager: 'Medi-Learn', rest: 5, expiry: d(2027, 1, 1), received: d(2026, 1, 1), blocked: true, row: 9 },
  { lot: 'LX', lager: 'Medi-Learn', rest: 3, expiry: d(2026, 1, 1), received: d(2025, 1, 1), blocked: false, row: 10 }
];
const inML = L.LB_byLager(mlots, 'Medi-Learn'), inMB = L.LB_byLager(mlots, ' Medbuy ');

t('LOTs je Lager getrennt, FEFO nur aus dem gewählten Lager', () => {
  assert.deepStrictEqual(inML.map(l => l.lot), ['L1', 'LG', 'LX']);
  assert.deepStrictEqual(L.LB_suggest(inMB, 5, today).parts, [{ lot: 'L0', qty: 2 }, { lot: 'L1', qty: 3 }]);
  assert.deepStrictEqual(L.LB_suggest(inML, 5, today).parts, [{ lot: 'L1', qty: 5 }]);
});

t('Lager ist Pflicht und muss aus der Liste kommen', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lager: 'Lager X', lsNo: 'LS', qty: 1, parts: null }, { members, lagers, item, lots: inML, today });
  assert.ok(v.errors.some(e => e.includes('Lager')));
  const r = L.LB_validateReceipt({ member: 'Doris', lager: '', qty: 1, lot: 'N1' }, { members, lagers, item, lots: [], today });
  assert.ok(r.errors.some(e => e.includes('Lager')));
});

t('Gleiche LOT in anderem Lager: Eingang legt neue LOT-Zeile an (keine Rückfrage)', () => {
  const r = L.LB_validateReceipt({ member: 'Doris', lager: 'Medichem', qty: 1, lot: 'L1' }, { members, lagers, item, lots: L.LB_byLager(mlots, 'Medichem'), today });
  assert.deepStrictEqual(r.errors, []); assert.strictEqual(r.existingLot, null);
  const s = L.LB_validateReceipt({ member: 'Doris', lager: 'Medbuy', qty: 1, lot: 'L1' }, { members, lagers, item, lots: inMB, today });
  assert.ok(s.existingLot && s.existingLot.row === 7);
});

t('Ausgang: LOT aus anderem Lager wird abgelehnt', () => {
  const v = L.LB_validateShipment({ member: 'Doris', lager: 'Medbuy', lsNo: 'LS', qty: 1, parts: [{ lot: 'LG', qty: 1 }] }, { members, lagers, item, lots: inMB, today });
  assert.ok(v.errors.some(e => e.includes('in diesem Lager nicht')));
});

t('Umlagerung: Pflichtfelder, gleiches Lager, LS optional', () => {
  const ctx = { members, lagers, item: { lotRequired: true, stock: 18 }, lots: inML, today };
  const same = L.LB_validateTransfer({ member: 'Doris', from: 'Medi-Learn', to: 'Medi-Learn', qty: 1, parts: null }, ctx);
  assert.ok(same.errors.some(e => e.includes('verschieden')));
  const noTo = L.LB_validateTransfer({ member: 'Doris', from: 'Medi-Learn', to: '', qty: 1, parts: null }, ctx);
  assert.ok(noTo.errors.some(e => e.includes('Ziellager')));
  const ok = L.LB_validateTransfer({ member: 'Doris', from: 'Medi-Learn', to: 'Medbuy', qty: 4, parts: null }, ctx);
  assert.deepStrictEqual(ok.errors, []); assert.deepStrictEqual(ok.warnings, []);
  assert.deepStrictEqual(ok.parts, [{ lot: 'L1', qty: 4 }]);
});

t('Umlagerung: gesperrte/abgelaufene LOT erlaubt mit Warnung, nicht im Vorschlag', () => {
  const ctx = { members, lagers, item: { lotRequired: true, stock: 18 }, lots: inML, today };
  const v = L.LB_validateTransfer({ member: 'Doris', from: 'Medi-Learn', to: 'Medbuy', qty: 8, parts: [{ lot: 'LG', qty: 5 }, { lot: 'LX', qty: 3 }] }, ctx);
  assert.deepStrictEqual(v.errors, []);
  assert.ok(v.warnings.some(w => w.includes('gesperrt')) && v.warnings.some(w => w.includes('abgelaufen')));
  assert.deepStrictEqual(v.parts, [{ lot: 'LG', qty: 5 }, { lot: 'LX', qty: 3 }]);
  const s = L.LB_validateTransfer({ member: 'Doris', from: 'Medi-Learn', to: 'Medbuy', qty: 12, parts: null }, ctx);
  assert.deepStrictEqual(s.parts, [{ lot: 'L1', qty: 10 }]); assert.strictEqual(s.missing, 2);
  assert.ok(s.warnings.some(w => w.includes('ohne LOT')));
  const over = L.LB_validateTransfer({ member: 'Doris', from: 'Medi-Learn', to: 'Medbuy', qty: 30, parts: null }, ctx);
  assert.ok(over.warnings.some(w => w.includes('Quelllager')));
});

t('LOT-Zustand für die Bestandsansicht', () => {
  const st = l => L.LB_lotState(l, today, 90);
  assert.strictEqual(st({ rest: 5, blocked: false, expiry: d(2028, 1, 1) }), 'frei');
  assert.strictEqual(st({ rest: 5, blocked: false, expiry: d(2026, 12, 31) }), 'bald');
  assert.strictEqual(st({ rest: 5, blocked: true, expiry: null }), 'gesperrt');
  assert.strictEqual(st({ rest: 5, blocked: false, expiry: d(2026, 10, 1) }), 'abgelaufen');
  assert.strictEqual(st({ rest: 0, blocked: false, expiry: null }), 'aufgebraucht');
  assert.strictEqual(st({ rest: -1, blocked: false, expiry: null }), 'negativ');
});

t('Migration: Lager aus Warehouse, nie überschreiben, Unklares melden', () => {
  const rows = [
    { sheet: 'Sales', row: 7, item: 'A', lager: '' },
    { sheet: 'Sales', row: 8, item: 'A', lager: 'Medbuy' },
    { sheet: 'LOTs', row: 6, item: 'B', lager: '' },
    { sheet: 'LOTs', row: 7, item: 'C', lager: '' },
    { sheet: 'Correction', row: 7, item: 'Z', lager: '' },
    { sheet: 'Purchases', row: 7, item: '', lager: '' }
  ];
  const p = MIG.MIG_plan(rows, { A: 'Medi-Learn', B: '', C: 'Lager Nord' }, lagers);
  assert.deepStrictEqual(p.assign, [{ sheet: 'Sales', row: 7, item: 'A', lager: 'Medi-Learn' }]);
  assert.strictEqual(p.kept, 1);
  assert.deepStrictEqual(p.unclear.map(u => u.reason), ['kein Warehouse in Inventory', 'Warehouse "Lager Nord" ist kein Lager in Setup', 'Artikel nicht in Inventory']);
});

console.log('\n' + n + ' Tests bestanden');
