"""
Fiangshi Python client: ask before an agent pays an x402 endpoint.

One file, standard library only (Python 3.9+). Talks to a running Fiangshi server over HTTP, so any Python agent
framework (LangChain, CrewAI, AutoGen, the OpenAI / xAI / DeepSeek SDKs, or plain scripts) can check a payee first.
Fiangshi only advises: this client never pays, signs or holds money.

    from fiangshi_client import Fiangshi
    fs = Fiangshi()                                   # FIANGSHI_URL, default http://127.0.0.1:8787
    v = fs.preview("https://api.cleave.fi/x402/gas")
    if v.allowed:       pay(...)
    elif v.blocked:     print("do not pay:", v.reason)
    else:               ask_a_human(v)

Command line (same exit codes as the Node CLI: 0 ALLOW, 10 REVIEW / no record, 20 BLOCK, 1 error, 2 usage):

    python fiangshi_client.py preview <url> [--json]
    python fiangshi_client.py payee <0x address> [--json]
    python fiangshi_client.py receipt <id> [--json]
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

__version__ = "0.1.0"

EXIT_ALLOW, EXIT_REVIEW, EXIT_BLOCK, EXIT_ERROR, EXIT_USAGE = 0, 10, 20, 1, 2

_URL = re.compile(r"^https?://\S{1,2000}$", re.I)
_ADDR = re.compile(r"^0x[0-9a-f]{40}$")
_ID = re.compile(r"^[0-9a-f]{64}$")


class FiangshiError(Exception):
    """Fiangshi could not be reached, or answered with an error. Treat as REVIEW: do not pay."""


@dataclass
class Verdict:
    """One answer. Only an exact ALLOW is allowed; anything else fails closed to REVIEW."""

    verdict: str
    reason: Optional[str] = None
    rule: Optional[str] = None
    score: Optional[float] = None
    receipt_id: Optional[str] = None
    terms: Dict[str, Any] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def band(self) -> str:
        return self.verdict if self.verdict in ("ALLOW", "BLOCK") else "REVIEW"

    @property
    def allowed(self) -> bool:
        return self.band == "ALLOW"

    @property
    def blocked(self) -> bool:
        return self.band == "BLOCK"

    @property
    def exit_code(self) -> int:
        return {"ALLOW": EXIT_ALLOW, "BLOCK": EXIT_BLOCK}.get(self.band, EXIT_REVIEW)

    @property
    def next_step(self) -> str:
        return {
            "ALLOW": "go ahead: no rule fired and the evidence is strong (valid for 72 h)",
            "BLOCK": "do not pay",
        }.get(self.band, "ask a human, or lower the amount. Do not treat this as ALLOW.")


class Fiangshi:
    def __init__(self, base_url: Optional[str] = None, timeout: float = 60.0) -> None:
        self.base_url = (base_url or os.environ.get("FIANGSHI_URL") or "http://127.0.0.1:8787").rstrip("/")
        self.timeout = timeout

    # -- transport -------------------------------------------------------------------------------------------------
    def _get(self, path: str) -> tuple[int, Dict[str, Any]]:
        req = urllib.request.Request(self.base_url + path, headers={"accept": "application/json", "user-agent": f"fiangshi-python/{__version__}"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return r.status, json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:  # 4xx / 5xx / 402 still carry a JSON body
            try:
                return e.code, json.loads(e.read().decode("utf-8") or "{}")
            except ValueError:
                return e.code, {"error": f"HTTP {e.code}"}
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise FiangshiError(f"could not reach Fiangshi at {self.base_url}: {e}") from e

    # -- the four calls --------------------------------------------------------------------------------------------
    def preview(self, url: str) -> Verdict:
        """Free: one unpaid probe, the null-payee rule and the census answer for the wallet that would be paid."""
        if not _URL.match(url or ""):
            raise ValueError("url must start with http:// or https://")
        status, b = self._get("/v1/preview?url=" + urllib.parse.quote(url, safe=""))
        if status >= 400:
            raise FiangshiError(str(b.get("error", status)))
        rule = b.get("vow_fired") or (", ".join(b["vows_fired"]) if b.get("vows_fired") else None)
        return Verdict(str(b.get("verdict")), b.get("reason"), rule, b.get("score"), b.get("receipt_id"), b.get("terms") or {}, b)

    def payee(self, address: str) -> Verdict:
        """Free: the census record for one Base wallet. Not in the census -> no_record (REVIEW)."""
        a = (address or "").lower()
        if not _ADDR.match(a):
            raise ValueError("address must be 0x followed by 40 hex characters")
        _, b = self._get("/v1/index.json")
        hit = next((p for p in b.get("payees", []) if p.get("payee") == a), None)
        if not hit:
            return Verdict("no_record", "not in the census", raw={"address": a, "in_census": False})
        return Verdict(str(hit.get("band")), None, ", ".join(hit.get("vows") or []) or None, hit.get("score"), hit.get("receipt_id"), raw=hit)

    def verify_receipt(self, receipt_id: str) -> bool:
        """Free: recompute a receipt's sha256 and chain link. False means it was changed."""
        if not _ID.match(receipt_id or ""):
            raise ValueError("receipt id must be 64 lowercase hex characters")
        _, b = self._get("/v1/verify?id=" + receipt_id)
        return b.get("valid") is True

    def quote(self, url: str) -> Dict[str, Any]:
        """The price of the full paid check (x402 terms). Never pays. A dead-end payTo is answered BLOCK for free."""
        if not _URL.match(url or ""):
            raise ValueError("url must start with http:// or https://")
        path = "/v1/check?url=" + urllib.parse.quote(url, safe="")
        status, b = self._get(path)
        if status == 402:
            return {"payment_required": True, "pay_to_call": self.base_url + path, "terms": b}
        return {"payment_required": False, "answer": b}

    # -- function calling (OpenAI-compatible: OpenAI, xAI Grok, DeepSeek, local servers) -----------------------------
    @staticmethod
    def tools() -> List[Dict[str, Any]]:
        """Tool definitions to pass as `tools=` to an OpenAI-compatible chat API."""
        url = {"type": "object", "properties": {"url": {"type": "string", "description": "the x402 paid endpoint URL"}}, "required": ["url"]}
        return [
            {"type": "function", "function": {"name": "fiangshi_preview", "description": "Free pre-payment check of an x402 endpoint. Returns ALLOW, REVIEW, BLOCK or no_record for the wallet that would be paid. Pay only on ALLOW.", "parameters": url}},
            {"type": "function", "function": {"name": "fiangshi_payee", "description": "Free: the census record for one Base wallet address.", "parameters": {"type": "object", "properties": {"address": {"type": "string"}}, "required": ["address"]}}},
            {"type": "function", "function": {"name": "fiangshi_verify_receipt", "description": "Free: verify a Fiangshi receipt id.", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}},
        ]

    def call_tool(self, name: str, arguments: Any) -> str:
        """Run a tool call from the model and return the JSON string to send back as the tool message."""
        args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
        try:
            if name == "fiangshi_preview":
                v = self.preview(args.get("url", ""))
                return json.dumps({**v.raw, "band": v.band, "next": v.next_step})
            if name == "fiangshi_payee":
                v = self.payee(args.get("address", ""))
                return json.dumps({**v.raw, "band": v.band, "next": v.next_step})
            if name == "fiangshi_verify_receipt":
                return json.dumps({"valid": self.verify_receipt(args.get("id", ""))})
            return json.dumps({"error": f"unknown tool {name}"})
        except (ValueError, FiangshiError) as e:
            return json.dumps({"error": str(e), "band": "REVIEW", "next": "do not pay; ask a human"})


# -- command line ------------------------------------------------------------------------------------------------------
def _print(v: Verdict, as_json: bool, label: str) -> int:
    if as_json:
        print(json.dumps({**v.raw, "band": v.band, "exit_code": v.exit_code, "next": v.next_step}, indent=2))
    else:
        print(f"{v.verdict.upper()}  {label}")
        for k, val in (("rule", v.rule), ("reason", v.reason), ("score", v.score), ("receipt", v.receipt_id), ("next", v.next_step)):
            if val not in (None, ""):
                print(f"  {k:<9} {val}")
    return v.exit_code


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in argv
    args = [a for a in argv if not a.startswith("--")]
    fs = Fiangshi()
    usage = "usage: fiangshi_client.py preview <url> | payee <0x address> | receipt <id>  [--json]"
    if len(args) < 2:
        print(usage, file=sys.stderr)
        return EXIT_USAGE
    cmd, arg = args[0], args[1]
    try:
        if cmd == "preview":
            return _print(fs.preview(arg), as_json, re.sub(r"^https?://", "", arg))
        if cmd == "payee":
            return _print(fs.payee(arg), as_json, arg.lower())
        if cmd == "receipt":
            ok = fs.verify_receipt(arg)
            print(json.dumps({"valid": ok}) if as_json else ("VALID" if ok else "INVALID") + f"  receipt {arg[:16]}…")
            return 0 if ok else EXIT_ERROR
    except ValueError as e:
        print(f"usage error: {e}", file=sys.stderr)
        return EXIT_USAGE
    except FiangshiError as e:
        print(json.dumps({"error": str(e)}) if as_json else f"error: {e}", file=sys.stdout if as_json else sys.stderr)
        return EXIT_ERROR
    print(usage, file=sys.stderr)
    return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())
