# @mcpx-digital/site-health

**MCP server for polite, permission-based site health checks.**

Check HTTP status codes, find broken same-origin links, review SEO basics, and inspect common security headers — from Cursor, Claude Desktop, or any MCP client.

> **Permission required.** Only use this server on sites **you own** or have **explicit permission** to test. All tools are **defensive / informational only**. This package does **not** include exploit payloads, attack procedures, SQLi/XSS scanners, or other offensive tooling.

## Install (MCPX / npx)

```bash
npx -y @mcpx-digital/site-health
```

> **Publish note:** The package is prepared for npm as `@mcpx-digital/site-health`. If it is not on the registry yet, publish from this repo (`npm publish --access public`) after logging into an account with access to the `@mcpx-digital` scope. Until then you can run from a local clone or GitHub.

Fallback package name (if the `@mcpx-digital` scope is unavailable): `@theoryofshadows/site-health-mcp`.

## Cursor `mcp.json` example

Add to your Cursor MCP config (e.g. `~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "site-health": {
      "command": "npx",
      "args": ["-y", "@mcpx-digital/site-health"]
    }
  }
}
```

Local clone (no npm publish required):

```json
{
  "mcpServers": {
    "site-health": {
      "command": "node",
      "args": ["/absolute/path/to/site-health-mcp/index.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
|------|----------------|
| `http_status` | Check status codes for a list of URLs (max 25), with polite delay |
| `broken_links` | Same-origin crawl from a start URL, **max depth 2**, polite delay; report 4xx/5xx |
| `seo_basics` | Title, meta description, canonical present? + simple length / H1 hints |
| `security_headers` | Checklist of CSP, HSTS, X-Frame-Options, etc. — **presence/absence only** |

### Hard limits (built in)

- HTTP/HTTPS only
- Max depth **2** for crawls; max **40** pages
- Polite default delay (~400ms) between requests
- Custom User-Agent identifying this tool
- No paid APIs — plain Node.js `fetch` + `@modelcontextprotocol/sdk`

## Example prompts

- “Check HTTP status for https://example.com and https://example.com/missing”
- “Crawl https://mysite.com for broken links (depth 2)”
- “Run SEO basics on https://mysite.com/blog/post”
- “Which security headers are present on https://mysite.com?”

## Development

```bash
git clone https://github.com/TheoryofShadows/site-health-mcp.git
cd site-health-mcp
npm install
npm test
node index.js   # stdio MCP server
```

## Sell / list on MCPX

Suggested listing price: **$5–$9**.

1. Ensure the package is published to npm (`@mcpx-digital/site-health`).
2. List on [MCPX](https://www.mcpx.digital) with install command:
   `npx -y @mcpx-digital/site-health`
3. Emphasize: permission-based, defensive only, zero paid APIs, MIT.

## License

MIT © TheoryofShadows
