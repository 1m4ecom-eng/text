import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
const script = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const page = `<!DOCTYPE html><html lang="en-US" itemscope itemtype="http://schema.org/WebPage"><head><meta charset="utf-8"><title>Der Türblocker für Profis</title></head><body>
<a class="XMyrgf" href="/was-ist-der-lockblock-türblocker"><img src="https://lh7-us.googleusercontent.com/x" class="r9CsCb" role="img" aria-label="LOCKBLOCK - Der Türblocker"></a>
<img src="a.jpg" alt="Bestehender Alt-Text"><img src="b.jpg" alt=""><p>Text bleibt gleich</p></body></html>`;
const mf = new Miniflare({ modules: true, script, compatibilityDate: "2024-09-01",
  outboundService: (req) => new URL(req.url).pathname === "/robots.txt"
    ? new Response("nf", { status: 404, headers: { "content-type": "text/html" } })
    : new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }) });
for (const p of ["/", "/was-ist-der-lockblock-t%C3%BCrblocker", "/die-lockblock-t%C3%BCrblocker?x=1", "/impressum/", "/robots.txt"]) {
  const r = await mf.dispatchFetch("https://www.lock-block.eu" + p);
  const t = await r.text();
  console.log("==", p, r.status);
  console.log(" ", t.match(/<html[^>]*>/)?.[0]);
  console.log(" ", t.match(/<link rel="canonical"[^>]*>/)?.[0]);
  console.log(" ", (t.match(/<img[^>]*>/g) || []).map(s => s.match(/alt="[^"]*"/)?.[0] ?? "NO ALT").join(" | "));
  console.log("  text unchanged:", t.includes("<p>Text bleibt gleich</p>") && t.includes("<title>Der Türblocker für Profis</title>"));
}
await mf.dispose();
