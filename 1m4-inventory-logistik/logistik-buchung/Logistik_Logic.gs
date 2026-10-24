/**
 * 1M4 Logistik-Buchung – reine Logik (ohne Spreadsheet-Zugriff, lokal testbar).
 *
 * LOT-Regeln entsprechen LotTracking.gs (LOT_allocate) und den Formeln im Tab LOTs:
 *  - auswählbar: nicht "Gesperrt", Restbestand > 0, Verfallsdatum nicht vor heute
 *  - Reihenfolge (FEFO): Verfallsdatum, dann Eingangsdatum, dann Zeile; ohne Datum = zuletzt
 *  - Sales-Spalte "LOT": "L-1 (3); L-2 (2)", fehlender Bestand als "OHNE LOT (n)"
 * LOT-Zeilen sind lagergebunden: der Server übergibt nur die LOTs des gewählten Lagers.
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

/** lot: {lot, rest, expiry: Date|null, received: Date|null, blocked: bool, row, lager} */
function LB_isExpired(l, today) {
  return !!(l.expiry && l.expiry < LB_dayStart(today));
}

function LB_isSelectable(l, today) {
  return !l.blocked && l.rest > 0 && !LB_isExpired(l, today);
}

/** Zustand für die Bestandsansicht: frei | bald | gesperrt | abgelaufen | aufgebraucht | negativ */
function LB_lotState(l, today, warnDays) {
  if (l.rest < 0) return 'negativ';
  if (l.rest === 0) return 'aufgebraucht';
  if (l.blocked) return 'gesperrt';
  if (LB_isExpired(l, today)) return 'abgelaufen';
  if (l.expiry && (LB_dayStart(l.expiry) - LB_dayStart(today)) / 86400000 <= warnDays) return 'bald';
  return 'frei';
}

function LB_byLager(lots, lager) {
  var key = LB_norm(lager);
  return lots.filter(function (l) { return LB_norm(l.lager) === key; });
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

function LB_checkLager(name, lagers, label, errors) {
  if (!lagers) return;
  if (lagers.indexOf(LB_norm(name)) === -1) errors.push('Bitte ' + label + ' auswählen.');
}

function LB_checkCommon(input, ctx, errors) {
  if (ctx.members.indexOf(LB_norm(input.member)) === -1) errors.push('Bitte Mitarbeiter auswählen.');
  if (!ctx.item) errors.push('Bitte einen Artikel aus der Liste wählen.');
  if (!LB_isInt(input.qty) || input.qty <= 0) errors.push('Menge muss eine ganze Zahl größer 0 sein.');
}

/** Übernimmt LOT-Mengen aus der Eingabe; prüft Zugehörigkeit; blocked/expired: Fehler oder Warnung. */
function LB_takeParts(inputParts, lots, today, errors, warnings, lenient) {
  var parts = [];
  (inputParts || []).forEach(function (p) {
    var q = Number(p.qty);
    if (!q) return;
    var l = LB_findLot(lots, p.lot);
    if (!LB_isInt(q) || q < 0) { errors.push('Menge für LOT "' + p.lot + '" ist ungültig.'); return; }
    if (!l) { errors.push('LOT "' + p.lot + '" gibt es für diesen Artikel in diesem Lager nicht.'); return; }
    if (l.blocked) { (lenient ? warnings : errors).push('LOT "' + l.lot + '" ist gesperrt' + (lenient ? ' – die Sperre wird mit umgelagert.' : '.')); if (!lenient) return; }
    if (LB_isExpired(l, today)) { (lenient ? warnings : errors).push('LOT "' + l.lot + '" ist abgelaufen.'); if (!lenient) return; }
    if (q > l.rest) warnings.push('Menge ' + q + ' übersteigt den Restbestand der LOT "' + l.lot + '" (' + l.rest + ').');
    parts.push({ lot: l.lot, qty: q });
  });
  return parts;
}

/**
 * Wareneingang prüfen.
 * input: {member, lager, qty, lot, expiry: Date|null, vendor, ref, notes}
 * ctx:   {members, lagers, item: {lotRequired} | null, lots (nur dieses Lager), today}
 */
function LB_validateReceipt(input, ctx) {
  var errors = [], warnings = [], existing = null;
  LB_checkCommon(input, ctx, errors);
  LB_checkLager(input.lager, ctx.lagers, 'ein Lager', errors);
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
      warnings.push('LOT "' + existing.lot + '" existiert in diesem Lager bereits (Zeile ' + existing.row +
        ', Restbestand ' + existing.rest + '). Die Menge wird zur bestehenden LOT addiert, es wird keine neue LOT angelegt.');
      var a = existing.expiry ? existing.expiry.getTime() : null, b = input.expiry ? LB_dayStart(input.expiry).getTime() : null;
      if (b !== null && a !== b) warnings.push('Achtung: Das eingegebene Verfallsdatum weicht vom Verfallsdatum der bestehenden LOT ab. Es bleibt das bestehende Datum.');
    }
  }
  return { errors: errors, warnings: warnings, existingLot: existing };
}

/**
 * Warenausgang prüfen.
 * input: {member, lager, lsNo, qty, parts: [{lot, qty}] | null (= FEFO-Vorschlag), notes}
 * ctx:   {members, lagers, item: {lotRequired, stock (Lagerbestand)} | null, lots (nur dieses Lager), today}
 */
function LB_validateShipment(input, ctx) {
  var errors = [], warnings = [];
  LB_checkCommon(input, ctx, errors);
  LB_checkLager(input.lager, ctx.lagers, 'ein Lager', errors);
  if (!LB_norm(input.lsNo)) errors.push('Lieferscheinnummer (LS No.) ist Pflicht.');
  var res = { errors: errors, warnings: warnings, parts: [], missing: 0, lotText: '', suggestion: null };
  if (!ctx.item || !LB_isInt(input.qty) || input.qty <= 0) return res;

  var qty = input.qty, lots = ctx.lots || [];
  res.suggestion = LB_suggest(lots, qty, ctx.today);
  var parts = (input.parts && input.parts.length) ? LB_takeParts(input.parts, lots, ctx.today, errors, warnings, false) : res.suggestion.parts;
  var sum = parts.reduce(function (s, p) { return s + p.qty; }, 0);
  if (sum > qty) errors.push('Die LOT-Mengen (' + sum + ') sind größer als die Buchungsmenge (' + qty + ').');
  var missing = Math.max(qty - sum, 0);
  if (missing > 0 && (lots.length > 0 || ctx.item.lotRequired)) {
    warnings.push(missing + ' Stk. ohne freie LOT – Buchung als "' + LB_NONE + ' (' + missing + ')".');
  } else if (missing > 0) {
    missing = 0; // Artikel ohne LOT-Pflicht und ohne LOTs: keine LOT-Angabe
    parts = [];
  }
  if (typeof ctx.item.stock === 'number' && qty > ctx.item.stock) {
    warnings.push('Menge ' + qty + ' übersteigt den Bestand im Lager (' + ctx.item.stock + ').');
  }
  res.parts = parts;
  res.missing = missing;
  res.lotText = LB_formatLotText(parts, missing);
  return res;
}

/**
 * Korrektur prüfen.
 * input: {member, lager, type, qty, lot, notes}
 * ctx:   {members, lagers, types: [{name, sign}], item: {stock} | null, lots (nur dieses Lager), today}
 */
function LB_validateCorrection(input, ctx) {
  var errors = [], warnings = [];
  LB_checkCommon(input, ctx, errors);
  LB_checkLager(input.lager, ctx.lagers, 'ein Lager', errors);
  var type = null;
  (ctx.types || []).forEach(function (t) { if (LB_norm(t.name) === LB_norm(input.type)) type = t; });
  if (!type) errors.push('Bitte Korrekturtyp (+/−) auswählen.');
  if (!LB_norm(input.notes)) errors.push('Begründung ist Pflicht.');
  var lot = null;
  if (LB_norm(input.lot)) {
    lot = LB_findLot(ctx.lots || [], input.lot);
    if (!lot) errors.push('LOT "' + LB_norm(input.lot) + '" gibt es für diesen Artikel in diesem Lager nicht.');
  }
  if (type && type.sign < 0 && LB_isInt(input.qty) && ctx.item) {
    if (lot && input.qty > lot.rest) warnings.push('Minus-Korrektur ' + input.qty + ' übersteigt den Restbestand der LOT "' + lot.lot + '" (' + lot.rest + ').');
    if (typeof ctx.item.stock === 'number' && input.qty > ctx.item.stock) warnings.push('Minus-Korrektur ' + input.qty + ' übersteigt den Bestand im Lager (' + ctx.item.stock + ').');
  }
  return { errors: errors, warnings: warnings, sign: type ? type.sign : 0, typeName: type ? type.name : '', lot: lot };
}

/**
 * Umlagerung prüfen.
 * input: {member, from, to, qty, parts: [{lot, qty}] | null, lsNo (optional), notes}
 * ctx:   {members, lagers, item: {lotRequired, stock (Bestand im Quelllager)} | null, lots (Quelllager), today}
 * Gesperrte/abgelaufene LOTs sind erlaubt (Warnung); der FEFO-Vorschlag nimmt nur auswählbare LOTs.
 */
function LB_validateTransfer(input, ctx) {
  var errors = [], warnings = [];
  LB_checkCommon(input, ctx, errors);
  LB_checkLager(input.from, ctx.lagers, 'das Quelllager', errors);
  LB_checkLager(input.to, ctx.lagers, 'das Ziellager', errors);
  if (LB_norm(input.from) && LB_norm(input.from) === LB_norm(input.to)) errors.push('Quell- und Ziellager müssen verschieden sein.');
  var res = { errors: errors, warnings: warnings, parts: [], missing: 0, suggestion: null };
  if (!ctx.item || !LB_isInt(input.qty) || input.qty <= 0) return res;

  var qty = input.qty, lots = ctx.lots || [];
  res.suggestion = LB_suggest(lots, qty, ctx.today);
  var parts = (input.parts && input.parts.length) ? LB_takeParts(input.parts, lots, ctx.today, errors, warnings, true) : res.suggestion.parts;
  var sum = parts.reduce(function (s, p) { return s + p.qty; }, 0);
  if (sum > qty) errors.push('Die LOT-Mengen (' + sum + ') sind größer als die Umlagerungsmenge (' + qty + ').');
  var missing = Math.max(qty - sum, 0);
  if (missing > 0 && (lots.length > 0 || ctx.item.lotRequired)) warnings.push(missing + ' Stk. werden ohne LOT umgelagert.');
  if (typeof ctx.item.stock === 'number' && qty > ctx.item.stock) warnings.push('Menge ' + qty + ' übersteigt den Bestand im Quelllager (' + ctx.item.stock + ').');
  res.parts = parts;
  res.missing = missing;
  return res;
}

if (typeof module !== 'undefined') module.exports = {
  LB_norm: LB_norm, LB_suggest: LB_suggest, LB_formatLotText: LB_formatLotText, LB_isSelectable: LB_isSelectable,
  LB_fefoSort: LB_fefoSort, LB_byLager: LB_byLager, LB_lotState: LB_lotState,
  LB_validateReceipt: LB_validateReceipt, LB_validateShipment: LB_validateShipment,
  LB_validateCorrection: LB_validateCorrection, LB_validateTransfer: LB_validateTransfer
};
