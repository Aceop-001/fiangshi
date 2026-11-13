import { describe, it, expect, afterEach } from "vitest";
import { loadCensus, loadDemoStats } from "../src/census.js";
import { renderDoc, renderDocsHome, renderIndex, renderReceipt } from "../src/site.js";
import { setPagePath } from "../src/site-theme.js";

const SERVER_ONLY = /(?:href|action)="\/(?:check|tour\/done)\b/;

afterEach(() => {
  delete process.env.FIANGSHI_STATIC;
});

describe("static edition (GitHub Pages)", () => {
  it("the home page offers nothing that needs a live server, and says it is static", () => {
    process.env.FIANGSHI_STATIC = "1";
    setPagePath("/");
    const html = renderIndex(loadCensus(), loadDemoStats(), { tour: true });
    expect(html).not.toMatch(SERVER_ONLY);
    expect(html).not.toContain('class="tour"');
    expect(html).toContain("Static edition.");
    expect(html).toContain('fiangshi preview "https://api.example.com/paid"');
    expect(html).toMatch(/See the sealed receipts for <a href="\/receipt\/[0-9a-f]{64}">/);
  });
  it("the guide's try-it links open sealed receipts instead of the live check", () => {
    process.env.FIANGSHI_STATIC = "1";
    const html = renderDoc("guide", loadCensus(), loadDemoStats());
    expect(html).not.toMatch(SERVER_ONLY);
    expect(html).toMatch(/<a href="\/receipt\/[0-9a-f]{64}">x402\.tbs-digital\.com/);
  });
  it("the docs home does not offer a live check on the static edition", () => {
    process.env.FIANGSHI_STATIC = "1";
    const html = renderDocsHome(loadCensus(), loadDemoStats());
    expect(html).not.toContain("Paste a paid endpoint on the home page");
    expect(html).toContain("See the census");
  });
  it("a receipt page drops the probe-again link", () => {
    process.env.FIANGSHI_STATIC = "1";
    const c = loadCensus();
    const r = c.receipts.get(c.payees[0]!.receipt_id)!;
    const proof = { valid: true, errors: [], chain: "census #1" };
    const html = renderReceipt(r, proof, c, "http://127.0.0.1:8787", null);
    expect(html).not.toMatch(SERVER_ONLY);
    expect(html).not.toContain("probe this endpoint again");
    delete process.env.FIANGSHI_STATIC;
    expect(renderReceipt(r, proof, c, "http://127.0.0.1:8787", null)).toContain("probe this endpoint again");
  });
  it("the live edition is unchanged: form, try links and tour are still there", () => {
    setPagePath("/");
    const html = renderIndex(loadCensus(), loadDemoStats(), { tour: true });
    expect(html).toContain('<form class="probe" action="/check"');
    expect(html).toContain('class="tour"');
    expect(html).not.toContain("Static edition.");
  });
});
