/**
 * A small Markdown subset -> HTML, for docs/GUIDE.md and docs/LEGAL.md (no dependency).
 * Supported: # headings (1-4), paragraphs, "- " and "1. " lists, > quotes, pipe tables, ``` fences, and inline
 * `code`, **bold**, *emphasis*, [text](href). Every character of the source is HTML-escaped before any tag is added,
 * so raw HTML in a document is shown as text, never executed. Links are kept only for /, #, https: and mailto: targets.
 */
export interface Heading { level: number; id: string; text: string }
export interface Rendered { html: string; headings: Heading[]; title: string | null }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function inline(src: string): string {
  // split on code spans first: nothing inside backticks is formatted
  return src
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return `<code>${esc(part.slice(1, -1))}</code>`;
      return esc(part)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, href: string) =>
          /^(\/|#|https:\/\/|mailto:)/.test(href) ? `<a href="${href}"${href.startsWith("https://") ? ' rel="noreferrer"' : ""}>${text}</a>` : m,
        )
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");
    })
    .join("");
}

const plain = (s: string) => s.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function renderMarkdown(src: string): Rendered {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const headings: Heading[] = [];
  const used = new Set<string>();
  let title: string | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const slug = (text: string) => {
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^```\s*([A-Za-z0-9-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) body.push(lines[i]!);
      out.push(`<pre${fence[1] ? ` class="lang-${fence[1]}"` : ""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      const level = h[1]!.length;
      const text = plain(h[2]!);
      const id = slug(text);
      if (level === 1 && title === null) title = text;
      headings.push({ level, id, text });
      out.push(`<h${level} id="${id}">${inline(h[2]!)}</h${level}>`);
      continue;
    }
    if (line.startsWith("|") && /^\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.startsWith("|"); i++) rows.push(cells(lines[i]!));
      i--;
      out.push(
        `<div class="scroll"><table class="tbl"><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table></div>`,
      );
      continue;
    }
    if (line.startsWith("> ") || line === ">") {
      flush();
      const body: string[] = [];
      for (; i < lines.length && (lines[i]!.startsWith("> ") || lines[i] === ">"); i++) body.push(lines[i]!.slice(2));
      i--;
      out.push(`<blockquote><p>${inline(body.join(" "))}</p></blockquote>`);
      continue;
    }
    const ul = /^-\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const tag = ul ? "ul" : "ol";
      const item = ul ? /^-\s+(.*)$/ : /^\d+\.\s+(.*)$/;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = item.exec(lines[i]!);
        if (m) items.push(m[1]!);
        else if (/^\s{2,}\S/.test(lines[i]!) && items.length) items[items.length - 1] += ` ${lines[i]!.trim()}`; // wrapped item text
        else break;
      }
      i--;
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return { html: out.join("\n"), headings, title };
}

/** The fenced blocks of one kind, by their info word (```json check-paid -> "check-paid"). Used by the docs tests. */
export function fencedBlocks(src: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  for (const m of src.replace(/\r\n?/g, "\n").matchAll(/^```[A-Za-z0-9-]*[ \t]+([A-Za-z0-9-]+)[ \t]*\n([\s\S]*?)\n```/gm)) blocks[m[1]!] = m[2]!;
  return blocks;
}
