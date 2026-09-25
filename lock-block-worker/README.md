# lock-block-worker

Cloudflare Worker für **www.lock-block.eu** (Google Sites hinter Cloudflare).
Behebt die technischen Befunde aus dem Seobility-Audit vom 25.09.2026
(Projekt „Lockblock“). Sichtbarer Seitentext wird nicht verändert.

## Was der Worker ändert

| Seobility-Befund | Ursache | Fix im Worker |
|---|---|---|
| Widersprüchliche Sprachangabe (3 Seiten) | Google Sites setzt `<html lang="en-US">`, Inhalt ist Deutsch | `lang="de-DE"` |
| Fehlende Alt-Attribute (11 Seiten) + Bild-Link ohne Alt | Logo im Sites-Header hat nur `aria-label` | `alt` wird aus dem vorhandenen `aria-label` übernommen |
| Duplicate Content, doppelter Titel, konkurrierende Seiten `/` ↔ `/was-ist-der-lockblock-türblocker` | Google Sites liefert die Startseite unter `/` und unter ihrem Slug aus | Canonical-Link auf jeder Seite; der Startseiten-Slug verweist auf `/` |

## Nicht per Technik behebbar (Textänderung oder außerhalb unseres Einflusses)

- Fehlende Meta-Descriptions (11 Seiten): Die Texte müssen erst geschrieben werden. Google Sites bietet kein Feld dafür.
- Fehlende H1 und Überschriften auf `/Lockblock-Turblocker-Anwendungsbilder`
- Doppelte Textblöcke, wenige Absätze, wenig Text, H1-Keywords nicht im Text (`/lockblock-bezugsquellen`)
- Nicht abrufbare Bilder (403) von `lh7-us.googleusercontent.com`: Google blockiert dort den Seobility-Bot. Das lässt sich nicht beheben.

## Bereits live erledigt (Prüfung vom 25.09.2026)

- www-Weiterleitung: `http(s)://lock-block.eu/` und `http://www.lock-block.eu/` leiten per 301 auf `https://www.lock-block.eu/` weiter.
- Externer Link auf `https://www.1m4.eu/` („Domain not connected“): Die Adresse antwortet mit 200. Seobility speichert Ergebnisse zu externen Links mehrere Tage zwischen, deshalb erscheint der alte Befund noch.

## Test

```sh
npm install
npm test
```

## Deployment (macht die Änderung sofort live)

Variante A, Dashboard: Workers & Pages → Create Worker → Code aus
`src/index.js` einfügen → Deploy. Danach unter Settings → Domains & Routes die Route
`www.lock-block.eu/*` (Zone `lock-block.eu`) hinzufügen.

Variante B, CLI: `npx wrangler deploy`. Dafür braucht es einen API-Token mit
*Account → Workers Scripts: Edit* und *Zone → Workers Routes: Edit*.

Zurücknehmen: Route löschen oder Worker deaktivieren. Die Seite wird dann wieder
unverändert von Google Sites ausgeliefert.
