import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { fencedBlocks, renderMarkdown } from "../src/md.js";

describe("markdown subset renderer", () => {
  it("escapes raw HTML everywhere: paragraphs, headings, lists, tables and code", () => {
    const { html } = renderMarkdown("# A <b>title</b>\n\n<script>alert(1)</script>\n\n- <img src=x onerror=1>\n\n| a |\n|---|\n| <i>x</i> |\n\n```\n</code><script>y()</script>\n```\n\n`<u>`");
    expect(html).not.toMatch(/<script|<img|<b>|<i>|<u>/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;/code&gt;&lt;script&gt;y()&lt;/script&gt;");
  });
  it("headings get unique ids and the first h1 is the title", () => {
    const r = renderMarkdown("# Guide\n\n## Limits\n\ntext\n\n## Limits\n\n### 1. Ask before you pay");
    expect(r.title).toBe("Guide");
    expect(r.headings.map((h) => [h.level, h.id])).toEqual([[1, "guide"], [2, "limits"], [2, "limits-2"], [3, "1-ask-before-you-pay"]]);
    expect(r.html).toContain('<h2 id="limits-2">Limits</h2>');
  });
  it("paragraphs, lists with wrapped items, quotes", () => {
    const { html } = renderMarkdown("one\ntwo\n\n- a\n  more\n- b\n\n1. first\n2. second\n\n> note\n> again");
    expect(html).toContain("<p>one two</p>");
    expect(html).toContain("<ul><li>a more</li><li>b</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<blockquote><p>note again</p></blockquote>");
  });
  it("tables and fenced code keep their content verbatim", () => {
    const { html } = renderMarkdown('| field | meaning |\n|---|---|\n| `band` | The **verdict** |\n\n```json check-paid\n{ "band": "ALLOW" }\n```');
    expect(html).toContain('<table class="tbl"><tr><th>field</th><th>meaning</th></tr><tr><td><code>band</code></td><td>The <strong>verdict</strong></td></tr></table>');
    expect(html).toContain('<pre class="lang-json"><code>{ &quot;band&quot;: &quot;ALLOW&quot; }</code></pre>');
  });
  it("inline code is never formatted; only safe link targets become links", () => {
    const { html } = renderMarkdown("`**not bold** [x](/y)` and **bold** and *em* and [guide](/docs#limits) [site](https://example.org/a) [mail](mailto:a@b.co) [bad](javascript:alert(1)) [rel](LEGAL.md)");
    expect(html).toContain("<code>**not bold** [x](/y)</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain('<a href="/docs#limits">guide</a>');
    expect(html).toContain('<a href="https://example.org/a" rel="noreferrer">site</a>');
    expect(html).toContain('<a href="mailto:a@b.co">mail</a>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="LEGAL.md"');
  });
  it("fencedBlocks finds tagged examples by name", () => {
    expect(fencedBlocks('text\n\n```json verify\n{ "valid": true }\n```\n\n```bash\ncurl x\n```\n')).toEqual({ verify: '{ "valid": true }' });
  });
});

describe("the documents themselves", () => {
  const read = (f: string) => readFileSync(join(ROOT, "docs", f), "utf8");
  it("the guide and the legal page render, with the sections the site links to", () => {
    const guide = renderMarkdown(read("GUIDE.md"));
    expect(guide.title).toBe("Fiangshi guide");
    expect(guide.headings.filter((h) => h.level === 2).map((h) => h.text)).toEqual(["Try it: real paid endpoints", "The agent flow", "How a verdict is made", "Routes", "Receipts", "Limits", "Run it yourself"]);
    const legal = renderMarkdown(read("LEGAL.md"));
    expect(legal.headings.filter((h) => h.level === 2).map((h) => h.text)).toEqual(["In short", "Terms of use", "Verdicts about sellers", "Privacy", "Licence and third parties", "Contact"]);
  });
  it("architecture, connect and report have the sections the site and the README promise", () => {
    const h2 = (f: string) => renderMarkdown(read(f)).headings.filter((h) => h.level === 2).map((h) => h.text);
    expect(h2("ARCHITECTURE.md")).toEqual(["The map", "See it working", "What each step does", "Outside services", "Storage", "Security and trust model", "Budgets and limits", "Configuration", "Failure modes", "What it does not do"]);
    expect(h2("CONNECT.md")).toEqual(["Before you start (all clients)", "The four tools", "Claude Code", "Claude Desktop", "Codex (OpenAI Codex CLI)", "Grok CLI", "Hermes", "Cursor", "VS Code (GitHub Copilot agent mode)", "Gemini CLI", "Any other MCP client", "xAI Grok API (function calling)", "DeepSeek API (function calling)", "Plain HTTP", "Troubleshooting"]);
    expect(h2("CLI.md")).toEqual(["Install the CLI", "Commands", "Exit codes", "Examples", "The agent skill", "Python client"]);
    expect(h2("REPORT.md")).toEqual(["Where things stand", "How we test", "Timeline", "Every failure, in order", "Rule changes, each one measured", "Surf: what we measured about the data source", "Still failing or not done"]);
  });
  it("the connect guide names only the four tools the MCP server has, and never hard-codes a model id", async () => {
    const { TOOLS } = await import("../src/mcp/server.js");
    const doc = read("CONNECT.md");
    const named = new Set([...doc.matchAll(/`(fiangshi_[a-z_]+)/g)].map((m) => m[1]));
    expect([...named].sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(doc).not.toMatch(/model\s*=\s*"/i);
  });
  it("every tagged JSON example in the guide is valid JSON", () => {
    const blocks = fencedBlocks(read("GUIDE.md"));
    expect(Object.keys(blocks).sort()).toEqual(["check-402", "check-block", "check-paid", "verify", "x-payment"]);
    for (const b of Object.values(blocks)) expect(() => JSON.parse(b)).not.toThrow();
  });
  it("the documents state no census band counts (those live on the index and in /v1/index.json only)", () => {
    for (const f of ["GUIDE.md", "LEGAL.md"]) expect(read(f)).not.toMatch(/\d+\s*(ALLOW|REVIEW|BLOCK)\b|(ALLOW|REVIEW|BLOCK)\s*[:·]?\s*\d{2,}/);
  });
});
