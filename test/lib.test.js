import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseHttpUrl,
  extractSameOriginLinks,
  extractTagContent,
  extractMetaContent,
  extractCanonical,
  countTags,
  sleep,
} from "../lib.js";

describe("parseHttpUrl", () => {
  it("accepts https URLs", () => {
    const u = parseHttpUrl("https://example.com/path");
    assert.equal(u.hostname, "example.com");
  });

  it("rejects non-http schemes", () => {
    assert.throws(() => parseHttpUrl("ftp://example.com"), /Only http\/https/);
  });

  it("rejects invalid URLs", () => {
    assert.throws(() => parseHttpUrl("not a url"), /Invalid URL/);
  });
});

describe("HTML extractors", () => {
  const html = `
    <html><head>
      <title>  Hello World Page </title>
      <meta name="description" content="A solid meta description that is long enough for checks." />
      <link rel="canonical" href="https://example.com/page" />
    </head>
    <body>
      <h1>Main</h1>
      <a href="/about">About</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://other.com/x">External</a>
      <a href="mailto:a@b.com">Mail</a>
    </body></html>
  `;

  it("extracts title", () => {
    assert.equal(extractTagContent(html, "title"), "Hello World Page");
  });

  it("extracts meta description", () => {
    assert.match(extractMetaContent(html, "description") || "", /solid meta description/);
  });

  it("extracts canonical", () => {
    assert.equal(extractCanonical(html, "https://example.com/"), "https://example.com/page");
  });

  it("counts h1 tags", () => {
    assert.equal(countTags(html, "h1"), 1);
  });

  it("extracts same-origin links only", () => {
    const links = extractSameOriginLinks(html, "https://example.com/", "https://example.com");
    assert.ok(links.includes("https://example.com/about"));
    assert.ok(links.includes("https://example.com/contact"));
    assert.ok(!links.some((l) => l.includes("other.com")));
    assert.ok(!links.some((l) => l.startsWith("mailto:")));
  });
});

describe("sleep", () => {
  it("resolves after delay", async () => {
    const t0 = Date.now();
    await sleep(50);
    assert.ok(Date.now() - t0 >= 40);
  });
});
