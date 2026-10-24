/**
 * 1M4 Inventory – Schutzbereiche "nur Warnung" für Formelspalten und Stammdaten.
 *
 * Warnung statt Sperre, weil die Logistik-Web-App unter dem Konto des Nutzers schreibt
 * und beim Einfügen neuer Zeilen Formeln in diese Spalten kopiert.
 * Einmalig im Script-Editor SCHUTZ_setup ausführen; erneutes Ausführen ersetzt die eigenen Bereiche.
 */

var SCHUTZ_CFG = {
  headerRow: 5,
  tag: '[1M4-Schutz]',
  columns: {
    'Sales': ['SKU', 'Stock on Hand', 'Sale Price', 'Sale Profit'],
    'Purchases': ['SKU', 'Difference', 'Total Cost', 'Shipping Days'],
    'Correction': ['SKU', 'Stock on Hand'],
    'LOTs': ['SKU', 'Ausgang Verkauf', 'Korrektur (+/−)', 'Restbestand', 'Status', 'Nächste']
  },
  wholeSheets: ['Inventory', 'Setup', 'Bestand je Lager']   // fehlende Tabs werden übersprungen
};

function SCHUTZ_setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), made = [];
  [SpreadsheetApp.ProtectionType.RANGE, SpreadsheetApp.ProtectionType.SHEET].forEach(function (type) {
    ss.getProtections(type).forEach(function (p) {
      if (String(p.getDescription()).indexOf(SCHUTZ_CFG.tag) === 0) p.remove();
    });
  });
  Object.keys(SCHUTZ_CFG.columns).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var head = sh.getRange(SCHUTZ_CFG.headerRow, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (v) { return String(v).replace(/\s+/g, ' ').trim(); });
    SCHUTZ_CFG.columns[name].forEach(function (h) {
      var c = head.indexOf(h);
      if (c === -1) throw new Error('Spalte "' + h + '" in "' + name + '" nicht gefunden.');
      var rng = sh.getRange(SCHUTZ_CFG.headerRow, c + 1, sh.getMaxRows() - SCHUTZ_CFG.headerRow + 1, 1);
      rng.protect().setDescription(SCHUTZ_CFG.tag + ' Formelspalte ' + name + ' / ' + h).setWarningOnly(true);
      made.push(name + ' / ' + h);
    });
  });
  SCHUTZ_CFG.wholeSheets.forEach(function (name) {
    if (!ss.getSheetByName(name)) return;
    ss.getSheetByName(name).protect().setDescription(SCHUTZ_CFG.tag + ' Stammdaten ' + name).setWarningOnly(true);
    made.push(name + ' (ganzes Blatt)');
  });
  ss.toast(made.length + ' Schutzbereiche (nur Warnung) gesetzt.', 'Schutz', 8);
  Logger.log(made.join('\n'));
}
