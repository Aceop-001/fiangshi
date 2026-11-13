"""Tests for the Python client. Offline parts always run; the live parts need FIANGSHI_URL pointing at a server.

    python -m unittest discover -s clients/python -v
"""
import json
import os
import socket
import threading
import unittest

from fiangshi_client import EXIT_BLOCK, EXIT_REVIEW, Fiangshi, FiangshiError, Verdict, main

NULL_PAYEE_URL = "https://api.cleave.fi/x402/gas"


class FailClosed(unittest.TestCase):
    def test_only_exact_allow_is_allowed(self):
        self.assertTrue(Verdict("ALLOW").allowed)
        self.assertTrue(Verdict("BLOCK").blocked)
        for v in ("REVIEW", "no_record", "no_verdict", "allow", "", "None"):
            self.assertEqual(Verdict(v).band, "REVIEW", v)
            self.assertFalse(Verdict(v).allowed, v)
            self.assertEqual(Verdict(v).exit_code, EXIT_REVIEW, v)

    def test_bad_arguments_are_refused_before_any_request(self):
        fs = Fiangshi("http://127.0.0.1:1")
        for call, arg in ((fs.preview, "not a url"), (fs.payee, "bob"), (fs.verify_receipt, "abc")):
            with self.assertRaises(ValueError):
                call(arg)

    def test_unreachable_server_is_an_error_not_an_allow(self):
        # a local socket that accepts and hangs up at once: a broken server without waiting on a refused port
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(8)
        stop = threading.Event()

        def hang_up():
            srv.settimeout(0.2)
            while not stop.is_set():
                try:
                    conn, _ = srv.accept()
                    conn.close()
                except OSError:
                    pass

        t = threading.Thread(target=hang_up, daemon=True)
        t.start()
        try:
            url = "http://127.0.0.1:%d" % srv.getsockname()[1]
            with self.assertRaises(FiangshiError):
                Fiangshi(url, timeout=3).preview(NULL_PAYEE_URL)
            out = json.loads(Fiangshi(url, timeout=3).call_tool("fiangshi_preview", {"url": NULL_PAYEE_URL}))
            self.assertEqual(out["band"], "REVIEW")
        finally:
            stop.set()
            t.join(1)
            srv.close()

    def test_tool_definitions(self):
        names = [t["function"]["name"] for t in Fiangshi.tools()]
        self.assertEqual(names, ["fiangshi_preview", "fiangshi_payee", "fiangshi_verify_receipt"])


@unittest.skipUnless(os.environ.get("FIANGSHI_URL"), "set FIANGSHI_URL to run against a server")
class AgainstServer(unittest.TestCase):
    def test_null_payee_is_blocked_with_a_verifiable_receipt(self):
        fs = Fiangshi()
        v = fs.preview(NULL_PAYEE_URL)
        self.assertTrue(v.blocked)
        self.assertEqual(v.rule, "null_payee")
        self.assertEqual(v.exit_code, EXIT_BLOCK)
        self.assertTrue(fs.verify_receipt(v.receipt_id))

    def test_unknown_payee_is_no_record(self):
        v = Fiangshi().payee("0x0000000000000000000000000000000000000001")
        self.assertEqual(v.verdict, "no_record")
        self.assertFalse(v.allowed)

    def test_tool_call_round_trip(self):
        out = json.loads(Fiangshi().call_tool("fiangshi_preview", json.dumps({"url": NULL_PAYEE_URL})))
        self.assertEqual(out["band"], "BLOCK")

    def test_cli_exit_code(self):
        self.assertEqual(main(["preview", NULL_PAYEE_URL, "--json"]), EXIT_BLOCK)


if __name__ == "__main__":
    unittest.main()
