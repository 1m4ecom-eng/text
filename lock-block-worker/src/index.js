/**
 * Cloudflare Worker for www.lock-block.eu (Google Sites behind Cloudflare).
 *
 * Fixes the technical findings of the Seobility audit from 2026-09-25 that
 * Google Sites cannot fix itself. It changes no visible page text:
 *
 *  1. "Conflicting language markup": Google Sites renders <html lang="en-US">
 *     for this German site. The lang attribute is set to "de-DE".
 *  2. "Images with missing alt attributes" / "link contains an image but has
 *     no alt attribute": the site logo in the Google Sites header has an
 *     aria-label but no alt. The alt is copied from the existing aria-label.
 *  3. "Duplicate content" / "Duplicate page titles" / competing pages:
 *     Google Sites serves the home page both at "/" and at its own slug
 *     "/was-ist-der-lockblock-türblocker". Every page gets a canonical link;
 *     the home page slug points to "/".
 */

const CANONICAL_ORIGIN = "https://www.lock-block.eu";
const HOME_SLUG = "/was-ist-der-lockblock-türblocker";
const LANG = "de-DE";

export function canonicalFor(url) {
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.toLowerCase() === HOME_SLUG) path = "/";
  return CANONICAL_ORIGIN + encodeURI(path);
}

export default {
  async fetch(request) {
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    if (request.method !== "GET" || response.status !== 200 || !type.includes("text/html")) {
      return response;
    }

    const canonical = canonicalFor(new URL(request.url));
    let hasCanonical = false;

    return new HTMLRewriter()
      .on("html", {
        element(el) {
          el.setAttribute("lang", LANG);
        },
      })
      .on("img", {
        element(el) {
          const alt = el.getAttribute("alt");
          const label = el.getAttribute("aria-label");
          if ((alt === null || alt.trim() === "") && label && label.trim() !== "") {
            el.setAttribute("alt", label);
          }
        },
      })
      .on('link[rel="canonical"]', {
        element() {
          hasCanonical = true;
        },
      })
      .on("head", {
        element(el) {
          el.onEndTag((end) => {
            if (!hasCanonical) {
              end.before(`<link rel="canonical" href="${canonical}">`, { html: true });
            }
          });
        },
      })
      .transform(response);
  },
};
