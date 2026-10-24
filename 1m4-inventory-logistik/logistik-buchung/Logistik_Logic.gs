/**
 * 1M4 Logistik-Buchung – reine Logik (ohne Spreadsheet-Zugriff, lokal testbar).
 *
 * LOT-Regeln entsprechen LotTracking.gs (LOT_allocate) und den Formeln im Tab LOTs:
 *  - auswählbar: nicht "Gesperrt", Restbestand > 0, Verfallsdatum nicht vor heute
 *  - Reihenfolge (FEFO): Verfallsdatum, dann Eingangsdatum, dann Zeile; ohne Datum = zuletzt
 *  - Sales-Spalte "LOT": "L-1 (3); L-2 (2)", fehlender Bestand als "OHNE LOT (n)"
 */

var LB_NONE = 'OHNE LOT';

function LB_norm(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
}

function LB_dayStart(d) {
  var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x;
}

function LB_isInt(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
}

/** lot: {lot, rest, expiry: Date|null, received: Date|null, blocked: bool, row} */
function LB_isExpired(l, today) {
  return !!(l.expiry && l.expiry < LB_dayStart(today));
}

function LB_isSelectable(l, today) {
  return !l.blocked && l.rest > 0 && !LB_isExpired(l, today);
}

function LB_fefoSort(lots) {
  var key = function (d) { return d ? d.getTime() : Infinity; };
  return lots.slice().sort(function (a, b) {
    return (key(a.expiry) - key(b.expiry)) || (key(a.received) - key(b.received)) || (a.row - b.row);
  });
}

/** FEFO-Vorschlag: verteilt qty auf auswählbare LOTs. */
function LB_suggest(lots, qty, today) {
  var parts = [], open = qty;
  LB_fefoSort(lots.filter(function (l) { return LB_isSelectable(l, today); })).forEach(function (l) {
    if (open <= 0) return;
    var take = Math.min(l.rest, open);
    parts.push({ lot: l.lot, qty: take });
    open -= take;
  });
  return { parts: parts, missing: Math.max(open, 0) };
}

/** [{lot, qty}] + fehlende Menge -> Text für Sales-Spalte "LOT". */
function LB_formatLotText(parts, missing) {
  var order = [], sum = {};
  parts.forEach(function (p) {
    if (!(p.qty > 0)) return;
    if (!(p.lot in sum)) { order.push(p.lot); sum[p.lot] = 0; }
    sum[p.lot] += p.qty;
  });
  var out = order.map(function (l) { return l + ' (' + sum[l] + ')'; });
  if (missing > 0) out.push(LB_NONE + ' (' + missing + ')');
  return out.join('; ');
}

function LB_findLot(lots, lot) {
  var key = LB_norm(lot);
  for (var i = 0; i < lots.length; i++) if (LB_norm(lots[i].lot) === key) return lots[i];
  return null;
}

function LB_checkCommon(input, ctx, errors) {
  if (ctx.members.indexOf(LB_norm(input.member)) === -1) errors.push('Bitte Mitarbeiter auswählen.');
  if (!ctx.item) errors.push('Bitte einen Artikel aus der Liste wählen.');
  if (!LB_isInt(input.qty) || input.qty <= 0) errors.push('Menge muss eine ganze Zahl größer 0 sein.');
}

/**
 * Wareneingang prüfen.
 * input: {member, qty, lot, expiry: Date|null, vendor, ref, notes}
 * ctx:   {members, item: {lotRequired} | null, lots, today}
 * Rückgabe: {errors, warnings, existingLot}
 */
function LB_validateReceipt(input, ctx) {
  var errors = [], warnings = [], existing = null;
  LB_checkCommon(input, ctx, errors);
  var lot = LB_norm(input.lot);
  if (ctx.item && ctx.item.lotRequired && !lot) errors.push('LOT ist für diesen Artikel Pflicht.');
  if (lot && lot.toUpperCase() === LB_NONE) errors.push('"' + LB_NONE + '" ist keine gültige LOT-Nummer.');
  if (lot && /[;()]/.test(lot)) errors.push('LOT darf keine Zeichen ; ( ) enthalten.');
  if (input.expiry && !(input.expiry instanceof Date && !isNaN(input.expiry))) errors.push('Verfallsdatum ist ungültig.');
  if (input.expiry instanceof Date && LB_isExpired({ expiry: input.expiry }, ctx.today)) {
    warnings.push('Das Verfallsdatum liegt in der Vergangenheit.');
  }
  if (lot && ctx.item) {
    existing = LB_findLot(ctx.lots, lot);
    if (existing) {
      warnings.push('LOT "' + existing.lot + '" existiert für diesen Artikel bereits (Zeile ' + existing.row +
        ', Restbestand ' + existing.rest + '). Die Menge wird zur bestehenden LOT addiert, es wird keine neue LOT angelegt.');
      var a = existing.expiry ? existing.expiry.getTime() : null, b = input.expiry ? LB_dayStart(input.expiry).getTime() : null;
      if (b !== null && a !== b) warnings.push('Achtung: Das eingegebene Verfallsdatum weicht vom Verfallsdatum der bestehenden LOT ab. Es bleibt das bestehende Datum.');
    }
  }
  return { errors: errors, warnings: warnings, existingLot: existing };
}

/**
 * Warenausgang prüfen.
 * input: {member, lsNo, qty, parts: [{lot, qty}] | null (= FEFO-Vorschlag), notes}
 * ctx:   {members, item: {lotRequired, stock} | null, lots, today}
 * Rückgabe: {errors, warnings, parts, missing, lotText, suggestion}
 */
function LB_validateShipment(input, ctx) {
  var errors = [], warnings = [];
  LB_checkCommon(input, ctx, errors);
  if (!LB_norm(input.lsNo)) errors.push('Lieferscheinnummer (LS No.) ist Pflicht.');
  var res = { errors: errors, warnings: warnings, parts: [], missing: 0, lotText: '', suggestion: null };
  if (!ctx.item || !LB_isInt(input.qty) || input.qty <= 0) return res;

  var qty = input.qty, lots = ctx.lots || [];
  res.suggestion = LB_suggest(lots, qty, ctx.today);
  var parts = [];
  if (input.parts && input.parts.length) {
    input.parts.forEach(function (p) {
      var q = Number(p.qty);
      if (!q) return;
      var l = LB_findLot(lots, p.lot);
      if (!LB_isInt(q) || q < 0) { errors.push('Menge für LOT "' + p.lot + '" ist ungültig.'); return; }
      if (!l) { errors.push('LOT "' + p.lot + '" gehört nicht zu diesem Artikel.'); return; }
      if (l.blocked) { errors.push('LOT "' + l.lot + '" ist gesperrt.'); return; }
      if (LB_isExpired(l, ctx.today)) { errors.push('LOT "' + l.lot + '" ist abgelaufen.'); return; }
      if (q > l.rest) warnings.push('Menge ' + q + ' übersteigt den Restbestand der LOT "' + l.lot + '" (' + l.rest + ').');
      parts.push({ lot: l.lot, qty: q });
    });
  } else {
    parts = res.suggestion.parts;
  }
  var sum = parts.reduce(function (s, p) { return s + p.qty; }, 0);
  if (sum > qty) errors.push('Die LOT-Mengen (' + sum + ') sind größer als die Buchungsmenge (' + qty + ').');
  var missing = Math.max(qty - sum, 0);
  var hasLots = lots.length > 0;
  if (missing > 0 && (hasLots || ctx.item.lotRequired)) {
    warnings.push(missing + ' Stk. ohne freie LOT – Buchung als "' + LB_NONE + ' (' + missing + ')".');
  } else if (missing > 0) {
    missing = 0; // Artikel ohne LOT-Pflicht und ohne LOTs: keine LOT-Angabe
    parts = [];
  }
  if (typeof ctx.item.stock === 'number' && qty > ctx.item.stock) {
    warnings.push('Menge ' + qty + ' übersteigt den Bestand (Stock on Hand: ' + ctx.item.stock + ').');
  }
  res.parts = parts;
  res.missing = missing;
  res.lotText = LB_formatLotText(parts, missing);
  return res;
}

/**
 * Korrektur prüfen.
 * input: {member, type, qty, lot, notes}
 * ctx:   {members, types: [{name, sign}], item: {stock} | null, lots, today}
 * Rückgabe: {errors, warnings, sign, lot}
 */
function LB_validateCorrection(input, ctx) {
  var errors = [], warnings = [];
  LB_checkCommon(input, ctx, errors);
  var type = null;
  (ctx.types || []).forEach(function (t) { if (LB_norm(t.name) === LB_norm(input.type)) type = t; });
  if (!type) errors.push('Bitte Korrekturtyp (+/−) auswählen.');
  if (!LB_norm(input.notes)) errors.push('Begründung ist Pflicht.');
  var lot = null;
  if (LB_norm(input.lot)) {
    lot = LB_findLot(ctx.lots || [], input.lot);
    if (!lot) errors.push('LOT "' + LB_norm(input.lot) + '" gehört nicht zu diesem Artikel.');
  }
  if (type && type.sign < 0 && LB_isInt(input.qty) && ctx.item) {
    if (lot && input.qty > lot.rest) warnings.push('Minus-Korrektur ' + input.qty + ' übersteigt den Restbestand der LOT "' + lot.lot + '" (' + lot.rest + ').');
    if (typeof ctx.item.stock === 'number' && input.qty > ctx.item.stock) warnings.push('Minus-Korrektur ' + input.qty + ' übersteigt den Bestand (Stock on Hand: ' + ctx.item.stock + ').');
  }
  return { errors: errors, warnings: warnings, sign: type ? type.sign : 0, typeName: type ? type.name : '', lot: lot };
}

if (typeof module !== 'undefined') module.exports = {
  LB_norm: LB_norm, LB_suggest: LB_suggest, LB_formatLotText: LB_formatLotText, LB_isSelectable: LB_isSelectable,
  LB_fefoSort: LB_fefoSort, LB_validateReceipt: LB_validateReceipt, LB_validateShipment: LB_validateShipment,
  LB_validateCorrection: LB_validateCorrection
};
