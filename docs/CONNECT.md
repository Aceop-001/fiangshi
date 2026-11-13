# Connect Fiangshi to your AI

Fiangshi can be used from any AI tool in three ways:

- **MCP**, for coding agents and desktop assistants: Claude Code, Claude Desktop, Codex, Grok CLI, Hermes, Cursor, VS Code and Gemini CLI. Fiangshi comes with its own MCP server (`src/mcp/server.ts`, no extra packages).
- **Function calling**, for model APIs: xAI Grok, DeepSeek, or any OpenAI-compatible API. Your code gives the model a tool and calls Fiangshi's HTTP API when the model asks.
- **Plain HTTP**, for anything else: `curl`, a script, or an x402 client.
- **The CLI and the agent skill**, for agents that run shell commands: see [CLI and skill](CLI.md). The skill teaches an agent to check before every payment; the CLI returns the verdict as its exit code.

Every way uses the same rules: Fiangshi only advises. It never pays, never signs and never holds money. Only ALLOW means go ahead. Treat REVIEW and `no_record` as "ask a human or lower the amount", and BLOCK as "do not pay".

## Before you start (all clients)

You need Node 20 or newer and a copy of this repository. Run these once:

```bash
git clone <your copy of the fiangshi repository> fiangshi
cd fiangshi
npm ci
npm run build
npm run dev
```

`npm run build` compiles the MCP server to `dist/src/mcp/server.js`. `npm run dev` starts the Fiangshi HTTP server at `http://127.0.0.1:8787`; keep it running. The MCP server is a small client of that HTTP server.

In the commands below, replace `<repo>` with the full path of your copy, for example `C:/Users/you/fiangshi` on Windows or `/home/you/fiangshi` on Linux and macOS. Use forward slashes, even on Windows.

The environment variable `FIANGSHI_URL` tells the MCP server where Fiangshi runs. Leave it as `http://127.0.0.1:8787` for a local server, or set it to your hosted Fiangshi address.

### Check the MCP server without any client

This sends the two first messages an AI client would send and prints the answers:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node <repo>/dist/src/mcp/server.js
```

You should see `"serverInfo":{"name":"fiangshi"` and four tools. The line `fiangshi MCP server ready` is a log on stderr, not part of the protocol.

## The four tools

| tool | cost | what it does |
|---|---|---|
| `fiangshi_preview(url)` | free | one unpaid probe of the endpoint; BLOCK for a dead-end payment address; otherwise the census answer for the wallet that would be paid (ALLOW, REVIEW, BLOCK or `no_record`) |
| `fiangshi_check(url)` | $0.05 cached, $0.15 cold | the full check. A dead-end address is still BLOCK for free. Otherwise it returns Fiangshi's own x402 payment terms: your agent's x402 wallet pays them and calls again with `X-PAYMENT`. The tool never pays. |
| `fiangshi_payee(address)` | free | the census record for one Base wallet |
| `fiangshi_verify_receipt(id)` | free | recomputes a receipt's hash and chain link; `valid: false` means it was changed |

A good instruction to give your agent: *"Before paying any x402 endpoint, call fiangshi_preview with its URL. Pay only if the verdict is ALLOW. If it is REVIEW or no_record, ask me first. If it is BLOCK, do not pay and tell me the reason."*

## Claude Code

Syntax checked against `claude mcp add --help` on 12 Nov 2026.

```bash
claude mcp add fiangshi -s user -e FIANGSHI_URL=http://127.0.0.1:8787 -- node <repo>/dist/src/mcp/server.js
```

- `-s user` makes it available in every project. Use `-s project` to write it into this project's `.mcp.json` instead, or `-s local` (the default) for this project only.
- Everything after `--` is the command that starts the server.

Check it:

```bash
claude mcp list
```

`fiangshi` should be listed as connected. In a session, type `/mcp` to see its four tools, then ask: *"Use fiangshi_preview on https://api.cleave.fi/x402/gas"*. The answer is BLOCK by rule I (`null_payee`), because that endpoint asks to be paid to the zero address.

To remove it: `claude mcp remove fiangshi -s user`.

## Claude Desktop

Open **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add Fiangshi under `mcpServers` (keep any servers already there):

```json
{
  "mcpServers": {
    "fiangshi": {
      "command": "node",
      "args": ["<repo>/dist/src/mcp/server.js"],
      "env": { "FIANGSHI_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

Quit Claude Desktop fully and open it again. The tools appear under the tools (plug) icon in the message box. If they do not, open **Settings → Developer**: it shows the server's status and its log.

## Codex (OpenAI Codex CLI)

Codex is not installed on the machine where this guide was written, so these steps follow the Codex documentation and the `config.toml` format; they were not run here.

With the command line:

```bash
codex mcp add fiangshi --env FIANGSHI_URL=http://127.0.0.1:8787 -- node <repo>/dist/src/mcp/server.js
```

Or by hand, in `~/.codex/config.toml` (on Windows, `%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.fiangshi]
command = "node"
args = ["<repo>/dist/src/mcp/server.js"]
env = { FIANGSHI_URL = "http://127.0.0.1:8787" }
```

Start a new Codex session and run `/mcp` to see the connected servers. Codex asks before it runs a tool; the Fiangshi tools only read, so approving them is safe.

## Grok CLI

Syntax checked against `grok mcp add --help` on 12 Nov 2026.

```bash
grok mcp add fiangshi -e FIANGSHI_URL=http://127.0.0.1:8787 -s user -- node <repo>/dist/src/mcp/server.js
```

- `-s user` writes it to `~/.grok/config.toml` for every project; `-s project` writes it for the current project only.
- Arguments for the server go after `--`.

Check it:

```bash
grok mcp list
```

## Hermes

Syntax checked against `hermes mcp add --help` and `hermes mcp test --help` on 12 Nov 2026.

```bash
hermes mcp add fiangshi --command node --env FIANGSHI_URL=http://127.0.0.1:8787 --args <repo>/dist/src/mcp/server.js
```

`--args` must be the last option: everything after it is passed to the server. Hermes saves the server in its `config.yaml` (on Windows, `%LOCALAPPDATA%\hermes\config.yaml`).

Check that Hermes can start it and list its tools:

```bash
hermes mcp test fiangshi
```

## Cursor

Follows Cursor's documented `mcp.json` format; not run on this machine.

Create `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` in one project:

```json
{
  "mcpServers": {
    "fiangshi": {
      "command": "node",
      "args": ["<repo>/dist/src/mcp/server.js"],
      "env": { "FIANGSHI_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

Open **Cursor Settings → MCP** and check that `fiangshi` is enabled with four tools.

## VS Code (GitHub Copilot agent mode)

Follows VS Code's documented `mcp.json` format; not run on this machine.

Create `.vscode/mcp.json` in your workspace. VS Code uses the key `servers`, not `mcpServers`:

```json
{
  "servers": {
    "fiangshi": {
      "type": "stdio",
      "command": "node",
      "args": ["<repo>/dist/src/mcp/server.js"],
      "env": { "FIANGSHI_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

A **Start** button appears above the server in the file. Then open Copilot Chat, switch to **Agent** mode, and pick the Fiangshi tools in the tools menu.

## Gemini CLI

Follows the Gemini CLI documented `settings.json` format; not run on this machine.

Add this to `~/.gemini/settings.json` (or `.gemini/settings.json` in a project):

```json
{
  "mcpServers": {
    "fiangshi": {
      "command": "node",
      "args": ["<repo>/dist/src/mcp/server.js"],
      "env": { "FIANGSHI_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

Start `gemini` and run `/mcp` to list the servers and their tools.

## Any other MCP client

Fiangshi's MCP server uses the standard stdio transport: one JSON-RPC 2.0 message per line on stdin and stdout. It answers `initialize`, `ping`, `tools/list` and `tools/call`, and accepts protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`. If a client asks how to start a server, give it:

- command: `node`
- arguments: `<repo>/dist/src/mcp/server.js`
- environment: `FIANGSHI_URL=http://127.0.0.1:8787`

## xAI Grok API (function calling)

The xAI API is OpenAI-compatible at `https://api.x.ai/v1` and supports function calling. Use any current Grok model from the xAI console. Your program defines the tool, the model asks for it, and your program calls Fiangshi.

Python, with the `openai` package:

```python
import json, os, urllib.parse, urllib.request
from openai import OpenAI

FIANGSHI = os.environ.get("FIANGSHI_URL", "http://127.0.0.1:8787")
client = OpenAI(base_url="https://api.x.ai/v1", api_key=os.environ["XAI_API_KEY"])
MODEL = os.environ["XAI_MODEL"]  # a Grok model id from your xAI console

tools = [{
    "type": "function",
    "function": {
        "name": "fiangshi_preview",
        "description": "Free pre-payment check of an x402 endpoint. Returns ALLOW, REVIEW, BLOCK or no_record "
                       "for the wallet that would be paid. Pay only on ALLOW.",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "the x402 endpoint URL"}},
            "required": ["url"],
        },
    },
}]

def fiangshi_preview(url):
    q = urllib.parse.urlencode({"url": url})
    with urllib.request.urlopen(f"{FIANGSHI}/v1/preview?{q}", timeout=60) as r:
        return r.read().decode()

messages = [{"role": "user", "content": "Is it safe to pay https://api.cleave.fi/x402/gas ?"}]
reply = client.chat.completions.create(model=MODEL, messages=messages, tools=tools)
msg = reply.choices[0].message
messages.append(msg)
for call in msg.tool_calls or []:
    args = json.loads(call.function.arguments)
    messages.append({"role": "tool", "tool_call_id": call.id, "content": fiangshi_preview(args["url"])})
final = client.chat.completions.create(model=MODEL, messages=messages, tools=tools)
print(final.choices[0].message.content)
```

Set `XAI_API_KEY` and `XAI_MODEL` in your environment. Never put the key in the code.

## DeepSeek API (function calling)

DeepSeek's API is OpenAI-compatible at `https://api.deepseek.com` and supports tool calls. The program above works unchanged except for three lines:

```python
client = OpenAI(base_url="https://api.deepseek.com", api_key=os.environ["DEEPSEEK_API_KEY"])
MODEL = os.environ["DEEPSEEK_MODEL"]  # a DeepSeek chat model id from the DeepSeek docs
```

and the environment variables `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL`.

The same pattern works for any OpenAI-compatible API (for example a local model server): change `base_url`, the key and the model id.

## Plain HTTP

Every route is a GET. Free routes answer JSON straight away; paid routes answer `402 Payment Required` with x402 terms until you send a valid `X-PAYMENT` header.

| route | cost | answer |
|---|---|---|
| `/v1/preview?url=` | free | probe + rule I + census answer, as JSON |
| `/v1/check?url=` | free BLOCK for a dead-end payTo, otherwise $0.05 (census) or $0.15 (cold) | verdict, evidence, model advice, receipt |
| `/v1/payee/:addr` | $0.02 | census record + receipt id |
| `/v1/index.json` | free | every census payee with band, score and receipt id |
| `/v1/receipt/:id` | free | the full receipt |
| `/v1/verify?id=` | free | `valid: true` or `false` |
| `/v1/badge/:addr.svg` | free | a badge coloured by band |
| `/health` | free | server status |

```bash
curl "http://127.0.0.1:8787/v1/preview?url=https%3A%2F%2Fapi.cleave.fi%2Fx402%2Fgas"
```

## Troubleshooting

| what you see | what it means | what to do |
|---|---|---|
| `could not reach Fiangshi at http://127.0.0.1:8787` | the HTTP server is not running | run `npm run dev` in the repository |
| the client says the server failed to start | wrong path to `server.js`, or no build | run `npm run build`; use the full path with forward slashes |
| `Cannot find module` | Node is older than 20, or `npm ci` was not run | upgrade Node; run `npm ci` |
| tools listed, but every answer is `error: not found` | the HTTP server is an older build without `/v1/preview` | restart `npm run dev` |
| `fiangshi_check` returns `payment_required` | expected: the full check is paid | pay with your x402 client, or use `fiangshi_preview` |
| `no_record` | the wallet is not in the census | the paid check fetches it (cold check); never treat `no_record` as ALLOW |
