/**
 * The documentation set: one list that drives the /docs home, the docs sidebar, previous/next links, the footer and
 * the routes. Each page is a Markdown file in docs/ rendered by renderDoc(). Order here is reading order.
 */
export type DocGroup = "Get started" | "How it works" | "Policies";

export interface DocPage {
  kind: "guide" | "connect" | "cli" | "architecture" | "report" | "legal";
  path: string;
  file: string;
  /** short label in the sidebar, nav and footer */
  label: string;
  group: DocGroup;
  /** one line on the docs home card */
  blurb: string;
  /** meta description */
  description: string;
  fallback: string;
}

export const DOC_GROUPS: DocGroup[] = ["Get started", "How it works", "Policies"];

export const DOC_PAGES: DocPage[] = [
  {
    kind: "guide",
    path: "/guide",
    file: "GUIDE.md",
    label: "Guide",
    group: "Get started",
    blurb: "Try real paid endpoints, follow one check step by step, and read every route.",
    description: "How an agent uses Fiangshi, how a verdict is made, and how to run it.",
    fallback: "Fiangshi guide",
  },
  {
    kind: "connect",
    path: "/connect",
    file: "CONNECT.md",
    label: "Connect",
    group: "Get started",
    blurb: "Set up Claude, Codex, Grok, Hermes, Cursor, VS Code, Gemini, xAI or DeepSeek.",
    description: "Install guides for Claude Code, Claude Desktop, Codex, Grok, Hermes, Cursor, VS Code, Gemini, xAI and DeepSeek.",
    fallback: "Connect Fiangshi to your AI",
  },
  {
    kind: "cli",
    path: "/cli",
    file: "CLI.md",
    label: "CLI and skill",
    group: "Get started",
    blurb: "A command line for agents with verdict exit codes, and a skill that teaches agents to ask first.",
    description: "The Fiangshi CLI for agents and scripts, its exit codes, and the Fiangshi agent skill.",
    fallback: "CLI and agent skill",
  },
  {
    kind: "architecture",
    path: "/architecture",
    file: "ARCHITECTURE.md",
    label: "Architecture",
    group: "How it works",
    blurb: "A live map of the eight steps, every outside service, the trust model and failure modes.",
    description: "How Fiangshi is built: the pipeline map, every outside service, storage, the trust model and failure modes.",
    fallback: "Fiangshi architecture",
  },
  {
    kind: "report",
    path: "/report",
    file: "REPORT.md",
    label: "Test report",
    group: "How it works",
    blurb: "Every failure in the build with its cause, fix and proof, and what is still open.",
    description: "Every failure in building Fiangshi, what fixed it, and what the tests say now.",
    fallback: "Test report",
  },
  {
    kind: "legal",
    path: "/legal",
    file: "LEGAL.md",
    label: "Legal",
    group: "Policies",
    blurb: "Terms of use, what a verdict about a seller means, privacy and the one cookie.",
    description: "Fiangshi terms of use, what a verdict about a seller means, privacy, licence.",
    fallback: "Legal",
  },
];

export const docByKind = (k: DocPage["kind"]): DocPage => DOC_PAGES.find((d) => d.kind === k)!;
export const docByPath = (p: string): DocPage | undefined => DOC_PAGES.find((d) => d.path === p);
