/**
 * Core site-health helpers — defensive / informational only.
 * Never scrapes credentials, never injects payloads, never probes for vulns.
 */

const DEFAULT_UA =
  "site-health-mcp/0.1 (+https://github.com/TheoryofShadows/site-health-mcp; polite site checks)";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_DELAY_MS = 400;
const MAX_URLS_PER_CALL = 25;
const MAX_CRAWL_PAGES = 40;

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} raw
 * @returns {URL}
 */
export function parseHttpUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Only http/https URLs are allowed: ${raw}`);
  }
  return u;
}

/**
 * @param {string} url
 * @param {{ method?: string, timeoutMs?: number, headers?: Record<string,string> }} [opts]
 */
export async function fetchWithTimeout(url, opts = {}) {
  const method = opts.method || "GET";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(opts.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * http_status — check status codes for a list of URLs.
 * @param {{ urls: string[], timeoutMs?: number, delayMs?: number }} input
 */
export async function httpStatus(input) {
  const urls = normalizeUrlList(input.urls);
  const delayMs = clamp(input.delayMs ?? DEFAULT_DELAY_MS, 0, 5_000);
  const timeoutMs = clamp(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 30_000);
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const url = urls[i];
    try {
      parseHttpUrl(url);
      const started = Date.now();
      const res = await fetchWithTimeout(url, { method: "GET", timeoutMs });
      // Drain body so connections close cleanly; discard content.
      await res.arrayBuffer().catch(() => null);
      results.push({
        url,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        finalUrl: res.url,
        redirected: res.redirected,
        elapsedMs: Date.now() - started,
      });
    } catch (err) {
      results.push({
        url,
        ok: false,
        status: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    checked: results.length,
    summary: {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    results,
    notice:
      "Only use on sites you own or have explicit permission to test. Defensive / informational only.",
  };
}

/**
 * broken_links — same-origin crawl, depth-limited, polite delay.
 * @param {{ startUrl: string, maxDepth?: number, delayMs?: number, timeoutMs?: number, maxPages?: number }} input
 */
export async function brokenLinks(input) {
  const start = parseHttpUrl(input.startUrl);
  const maxDepth = Math.min(2, Math.max(0, Number(input.maxDepth ?? 2)));
  const delayMs = clamp(input.delayMs ?? DEFAULT_DELAY_MS, 100, 5_000);
  const timeoutMs = clamp(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 30_000);
  const maxPages = clamp(input.maxPages ?? MAX_CRAWL_PAGES, 1, MAX_CRAWL_PAGES);

  const origin = start.origin;
  /** @type {Map<string, { status: number|null, error?: string, from: string, depth: number }>} */
  const seen = new Map();
  /** @type {{ url: string, depth: number, from: string }[]} */
  const queue = [{ url: start.href, depth: 0, from: "(start)" }];
  /** @type {{ url: string, status: number|null, error?: string, from: string, depth: number }[]} */
  const broken = [];
  let pagesFetched = 0;

  while (queue.length > 0 && pagesFetched < maxPages) {
    const item = queue.shift();
    if (!item) break;
    const normalized = normalizePageUrl(item.url);
    if (seen.has(normalized)) continue;

    if (pagesFetched > 0) await sleep(delayMs);
    pagesFetched += 1;

    try {
      const res = await fetchWithTimeout(normalized, { method: "GET", timeoutMs });
      const finalUrl = res.url;
      const sameOrigin = (() => {
        try {
          return new URL(finalUrl).origin === origin;
        } catch {
          return false;
        }
      })();

      const entry = {
        status: res.status,
        from: item.from,
        depth: item.depth,
      };
      seen.set(normalized, entry);

      if (res.status >= 400) {
        broken.push({ url: normalized, ...entry });
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const isHtml = ct.includes("text/html") || ct.includes("application/xhtml");
      let html = "";
      if (isHtml && sameOrigin && item.depth < maxDepth) {
        html = await res.text();
      } else {
        await res.arrayBuffer().catch(() => null);
      }

      if (html && item.depth < maxDepth) {
        const links = extractSameOriginLinks(html, finalUrl, origin);
        for (const link of links) {
          const n = normalizePageUrl(link);
          if (!seen.has(n) && !queue.some((q) => normalizePageUrl(q.url) === n)) {
            queue.push({ url: n, depth: item.depth + 1, from: normalized });
          }
        }
      }
    } catch (err) {
      const entry = {
        status: null,
        error: err instanceof Error ? err.message : String(err),
        from: item.from,
        depth: item.depth,
      };
      seen.set(normalized, entry);
      broken.push({ url: normalized, ...entry });
    }
  }

  return {
    startUrl: start.href,
    origin,
    maxDepth,
    pagesFetched,
    pagesQueuedRemaining: queue.length,
    linksChecked: seen.size,
    brokenCount: broken.length,
    broken,
    notice:
      "Same-origin crawl only (max depth 2). Only use on sites you own or have explicit permission to test.",
  };
}

/**
 * seo_basics — title, meta description, canonical presence.
 * @param {{ url: string, timeoutMs?: number }} input
 */
export async function seoBasics(input) {
  const url = parseHttpUrl(input.url).href;
  const timeoutMs = clamp(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 30_000);
  const res = await fetchWithTimeout(url, { method: "GET", timeoutMs });
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
    return {
      url,
      finalUrl: res.url,
      status: res.status,
      contentType: ct || null,
      error: "Response is not HTML; SEO basics apply to HTML documents.",
      notice: "Only use on sites you own or have explicit permission to test.",
    };
  }
  const html = await res.text();
  const title = extractTagContent(html, "title");
  const metaDescription = extractMetaContent(html, "description");
  const canonical = extractCanonical(html, res.url);
  const h1Count = countTags(html, "h1");

  const checks = {
    titlePresent: Boolean(title && title.trim()),
    titleLength: title ? title.trim().length : 0,
    titleLengthOk: title ? title.trim().length >= 10 && title.trim().length <= 70 : false,
    metaDescriptionPresent: Boolean(metaDescription && metaDescription.trim()),
    metaDescriptionLength: metaDescription ? metaDescription.trim().length : 0,
    metaDescriptionLengthOk: metaDescription
      ? metaDescription.trim().length >= 50 && metaDescription.trim().length <= 160
      : false,
    canonicalPresent: Boolean(canonical),
    singleH1: h1Count === 1,
    h1Count,
  };

  return {
    url,
    finalUrl: res.url,
    status: res.status,
    title: title ? title.trim() : null,
    metaDescription: metaDescription ? metaDescription.trim() : null,
    canonical,
    checks,
    notice:
      "Informational SEO checklist only. Only use on sites you own or have explicit permission to test.",
  };
}

/**
 * security_headers — checklist of common headers present/absent.
 * DEFENSIVE / INFORMATIONAL ONLY — no exploit testing.
 * @param {{ url: string, timeoutMs?: number }} input
 */
export async function securityHeaders(input) {
  const url = parseHttpUrl(input.url).href;
  const timeoutMs = clamp(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 30_000);
  // Prefer HEAD; fall back to GET if HEAD is rejected.
  let res;
  try {
    res = await fetchWithTimeout(url, { method: "HEAD", timeoutMs });
    if (res.status === 405 || res.status === 501) {
      res = await fetchWithTimeout(url, { method: "GET", timeoutMs });
      await res.arrayBuffer().catch(() => null);
    }
  } catch {
    res = await fetchWithTimeout(url, { method: "GET", timeoutMs });
    await res.arrayBuffer().catch(() => null);
  }

  const headers = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const checklist = [
    {
      name: "content-security-policy",
      present: Boolean(headers["content-security-policy"]),
      value: headers["content-security-policy"] || null,
      note: "Helps mitigate XSS and data injection by controlling allowed sources.",
    },
    {
      name: "strict-transport-security",
      present: Boolean(headers["strict-transport-security"]),
      value: headers["strict-transport-security"] || null,
      note: "Instructs browsers to use HTTPS only (HSTS).",
    },
    {
      name: "x-frame-options",
      present: Boolean(headers["x-frame-options"]),
      value: headers["x-frame-options"] || null,
      note: "Mitigates clickjacking; consider CSP frame-ancestors as modern alternative.",
    },
    {
      name: "x-content-type-options",
      present: Boolean(headers["x-content-type-options"]),
      value: headers["x-content-type-options"] || null,
      note: "Usually 'nosniff' — reduces MIME sniffing attacks.",
    },
    {
      name: "referrer-policy",
      present: Boolean(headers["referrer-policy"]),
      value: headers["referrer-policy"] || null,
      note: "Controls how much referrer information is sent.",
    },
    {
      name: "permissions-policy",
      present: Boolean(headers["permissions-policy"] || headers["feature-policy"]),
      value: headers["permissions-policy"] || headers["feature-policy"] || null,
      note: "Restricts browser features (camera, mic, geolocation, etc.).",
    },
    {
      name: "cross-origin-opener-policy",
      present: Boolean(headers["cross-origin-opener-policy"]),
      value: headers["cross-origin-opener-policy"] || null,
      note: "Isolates browsing context; helps with XS-Leaks / Spectre mitigations.",
    },
    {
      name: "cross-origin-resource-policy",
      present: Boolean(headers["cross-origin-resource-policy"]),
      value: headers["cross-origin-resource-policy"] || null,
      note: "Controls which origins can load this resource.",
    },
  ];

  const present = checklist.filter((c) => c.present).length;
  const missing = checklist.filter((c) => !c.present).map((c) => c.name);

  return {
    url,
    finalUrl: res.url,
    status: res.status,
    https: url.startsWith("https:"),
    summary: {
      checked: checklist.length,
      present,
      missingCount: missing.length,
      missing,
    },
    checklist,
    notice:
      "DEFENSIVE / INFORMATIONAL ONLY. This tool reports header presence/absence — it does not probe, exploit, or attack. Only use on sites you own or have explicit permission to test.",
  };
}

// --- helpers ---

/** @param {unknown} urls */
function normalizeUrlList(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("urls must be a non-empty array of strings");
  }
  if (urls.length > MAX_URLS_PER_CALL) {
    throw new Error(`At most ${MAX_URLS_PER_CALL} URLs per call`);
  }
  return urls.map((u) => String(u));
}

/** @param {number} n @param {number} min @param {number} max */
function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

/** Strip fragments; keep query (may affect status). */
function normalizePageUrl(url) {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

/**
 * @param {string} html
 * @param {string} baseUrl
 * @param {string} origin
 */
export function extractSameOriginLinks(html, baseUrl, origin) {
  const out = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      continue;
    }
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (abs.origin !== origin) continue;
      abs.hash = "";
      out.add(abs.href);
    } catch {
      // ignore bad hrefs
    }
  }
  return [...out];
}

/** @param {string} html @param {string} tag */
export function extractTagContent(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** @param {string} html @param {string} name */
export function extractMetaContent(html, name) {
  const re = new RegExp(
    `<meta\\b[^>]*\\b(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
    "i",
  );
  const m = html.match(re);
  if (!m) {
    // attribute order variant: content before name
    const re2 = new RegExp(
      `<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\b(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
      "i",
    );
    const m2 = html.match(re2);
    return m2 ? m2[1] : null;
  }
  const content = m[0].match(/\bcontent\s*=\s*["']([^"']*)["']/i);
  return content ? content[1] : null;
}

/** @param {string} html @param {string} baseUrl */
export function extractCanonical(html, baseUrl) {
  const re = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i;
  const m = html.match(re);
  if (!m) {
    const re2 = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']canonical["'][^>]*>/i;
    const m2 = html.match(re2);
    if (!m2) return null;
    try {
      return new URL(m2[1], baseUrl).href;
    } catch {
      return m2[1];
    }
  }
  const href = m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
  if (!href) return null;
  try {
    return new URL(href[1], baseUrl).href;
  } catch {
    return href[1];
  }
}

/** @param {string} html @param {string} tag */
export function countTags(html, tag) {
  const re = new RegExp(`<${tag}\\b`, "gi");
  return (html.match(re) || []).length;
}
