# CLI and agent skill

Fiangshi has a command line built for AI agents and scripts, and an agent skill that teaches an agent when and how to use it. The commands talk to a running Fiangshi server, print plain text or JSON, and return the verdict as the exit code, so an agent can decide without parsing anything. Nothing here pays, signs or holds money.

## Install the CLI

You need Node 20 or newer and a copy of this repository.

```bash
npm ci
npm run build
npm link
```

`npm link` puts a `fiangshi` command on your PATH. Without it, run `node <repo>/dist/src/cli/index.js` instead, or `npx tsx src/cli/index.ts` inside the repository.

The commands ask the Fiangshi server at `FIANGSHI_URL` (default `http://127.0.0.1:8787`). Start one with `npm run dev`, or point `FIANGSHI_URL` at a hosted copy.

## Commands

| command | cost | what it does |
|---|---|---|
| `fiangshi preview <url>` | free | Should I pay this x402 endpoint? One unpaid probe, the null-payee rule and the census answer. |
| `fiangshi payee <0x address>` | free | The census record for one wallet: band, score, rules fired, receipt id. |
| `fiangshi receipt <id>` | free | Verifies a receipt: recomputes its sha256 hash and its link in the chain. |
| `fiangshi quote <url>` | free to ask | The price of the full paid check. A dead-end payment address is answered BLOCK for free. It never pays. |
| `fiangshi skill install <agent>` | free | Copies the Fiangshi skill into an agent's skills folder (see below). |
| `fiangshi mcp` | free | Starts the MCP server on stdio, the same as `npm run mcp`. |
| `fiangshi help` | free | Lists the commands. |

Add `--json` to any command for machine output.

The older local-pipeline commands are still there: `fiangshi check <url> [--json] [--explain]` runs the whole check in-process (it needs the model keys, or fixture mode), and `verify`, `index` and `lab` work on local files.

## Exit codes

| code | meaning | what an agent should do |
|---|---|---|
| `0` | ALLOW | may pay, within what the user approved |
| `10` | REVIEW, `no_record` or `no_verdict` | ask the user, or lower the amount; never treat as ALLOW |
| `20` | BLOCK | do not pay; quote the reason |
| `1` | error (Fiangshi unreachable, or an error answer) | do not pay; treat as REVIEW |
| `2` | wrong arguments | fix the command |

Only an exact ALLOW gives `0`. Anything Fiangshi does not recognise falls to `10`.

## Examples

```bash
fiangshi preview "https://api.cleave.fi/x402/gas"
```

```text
BLOCK  api.cleave.fi/x402/gas
  source    null_payee rule at probe time
  rule      null_payee
  reason    zero_address: payTo 0x0000000000000000000000000000000000000000 is the zero address: funds sent there are unrecoverable
  pay to    0x0000000000000000000000000000000000000000
  receipt   <64-character receipt id>
  next      do not pay
```

The exit code is `20`. In a shell script:

```bash
fiangshi preview "$URL" --json > verdict.json
case $? in
  0)  echo "ALLOW: paying" ;;
  20) echo "BLOCK: not paying"; exit 1 ;;
  *)  echo "REVIEW: asking a human"; exit 1 ;;
esac
```

## The agent skill

The skill is one folder, `skills/fiangshi/`, with a `SKILL.md` in the open Agent Skills format: a name, a description that tells the agent when to use it, and instructions. It teaches the agent to check before every x402 payment, to treat REVIEW and no record as "ask", to quote the reason of a BLOCK, and to keep the receipt id. It works with the MCP tools, the CLI or plain HTTP, whichever the agent has.

Install it with the CLI. Each command copies the folder and nothing else, and refuses to overwrite an existing copy unless you add `--force`.

| agent | command | where it goes |
|---|---|---|
| Claude Code | `fiangshi skill install claude` | `~/.claude/skills/fiangshi/` (add `--project` for `.claude/skills/` in this project) |
| Codex | `fiangshi skill install codex` | `~/.codex/skills/fiangshi/` (or `$CODEX_HOME/skills`) |
| Grok CLI | `fiangshi skill install grok` | `~/.grok/skills/fiangshi/` |
| Hermes | `fiangshi skill install hermes` | the Hermes skills folder, under `finance/` (on Windows `%LOCALAPPDATA%\hermes\skills\finance\fiangshi\`) |

The folders above are the ones these tools use on the machine where this guide was written. If your tool keeps skills somewhere else, copy `skills/fiangshi/` there by hand. Any agent that reads Agent Skills can use it.

Start a new session after installing. In Claude Code you can call it by name with `/fiangshi`, but you do not need to: the description makes the agent load it whenever a payment comes up. In Hermes, `hermes skills list` shows it.

For the best result, give the agent the skill **and** the tools: the skill says what to do, and the MCP server or the CLI does it. See [Connect](CONNECT.md) for the MCP setup in each tool.
