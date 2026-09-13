#!/usr/bin/env node
/**
 * @mcpx-digital/site-health — Model Context Protocol server for polite site health checks.
 *
 * Tools (defensive / informational only):
 *   - http_status
 *   - broken_links
 *   - seo_basics
 *   - security_headers
 *
 * ONLY use on sites you own or have explicit permission to test.
 * Transport: stdio (Cursor, Claude Desktop, VS Code, mcpx CLI).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { httpStatus, brokenLinks, seoBasics, securityHeaders } from "./lib.js";

const PERMISSION_NOTICE =
  "Only use on sites you own or have explicit permission to test. Defensive/informational checks only — no exploit or attack tooling.";

const TOOLS = [
  {
    name: "http_status",
    description:
      "Check HTTP status codes for a list of URLs (max 25). Polite delay between requests. " +
      PERMISSION_NOTICE,
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "HTTP/HTTPS URLs to check (max 25).",
          minItems: 1,
          maxItems: 25,
        },
        delayMs: {
          type: "number",
          description: "Delay between requests in ms (default 400, max 5000).",
        },
        timeoutMs: {
          type: "number",
          description: "Per-request timeout in ms (default 12000).",
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "broken_links",
    description:
      "Same-origin crawl from a start URL (max depth 2), polite delay, report 4xx/5xx and fetch errors. " +
      PERMISSION_NOTICE,
    inputSchema: {
      type: "object",
      properties: {
        startUrl: {
          type: "string",
          description: "Start URL (must be http/https). Crawl stays on the same origin.",
        },
        maxDepth: {
          type: "number",
          description: "Crawl depth 0–2 (default 2, hard-capped at 2).",
        },
        delayMs: {
          type: "number",
          description: "Polite delay between page fetches in ms (default 400).",
        },
        timeoutMs: {
          type: "number",
          description: "Per-request timeout in ms (default 12000).",
        },
        maxPages: {
          type: "number",
          description: "Max pages to fetch (default 40, hard-capped at 40).",
        },
      },
      required: ["startUrl"],
    },
  },
  {
    name: "seo_basics",
    description:
      "Fetch an HTML page and report title, meta description, canonical link, and basic length/H1 checks. " +
      PERMISSION_NOTICE,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTML page URL to inspect." },
        timeoutMs: { type: "number", description: "Request timeout in ms (default 12000)." },
      },
      required: ["url"],
    },
  },
  {
    name: "security_headers",
    description:
      "Checklist of common security headers present/absent (CSP, HSTS, X-Frame-Options, etc.). " +
      "DEFENSIVE/INFORMATIONAL ONLY — does not probe, exploit, or attack. " +
      PERMISSION_NOTICE,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL whose response headers to inspect." },
        timeoutMs: { type: "number", description: "Request timeout in ms (default 12000)." },
      },
      required: ["url"],
    },
  },
];

const handlers = {
  http_status: httpStatus,
  broken_links: brokenLinks,
  seo_basics: seoBasics,
  security_headers: securityHeaders,
};

const server = new Server(
  { name: "site-health", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};
  const handler = handlers[name];
  if (!handler) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const result = await handler(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
