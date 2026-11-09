// Preload (node --import) that makes any outbound NETWORK attempt throw.
// Used by `npm run accept` for itself and every child process it spawns.
// Allowed (not network): local IPC (named pipes / unix sockets, used by tooling such as tsx) and LOOPBACK
// (127.0.0.1, ::1, localhost), so the API tests can talk to a server they start on 127.0.0.1.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";

const deny = (what) =>
  function () {
    globalThis.__fiangshiNetAttempts = (globalThis.__fiangshiNetAttempts ?? 0) + 1;
    throw new Error(`no-network: ${what} blocked during accept`);
  };

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);
const isLoopback = (h) => typeof h === "string" && LOOPBACK.has(h.toLowerCase());
const isLocalIpc = (a) => (typeof a === "string" && !/^\d+$/.test(a)) || (a && typeof a === "object" && typeof a.path === "string");

/** net.connect / createConnection: (options) | (path) | (port, host?) */
const netTarget = (args) => {
  const a = args[0];
  if (a && typeof a === "object") return a.host ?? "localhost";
  if (typeof a === "number" || /^\d+$/.test(String(a))) return typeof args[1] === "string" ? args[1] : "localhost";
  return null;
};
const guardNet = (orig, what) =>
  function (...args) {
    if (isLocalIpc(args[0])) return orig.apply(this, args);
    if (isLoopback(netTarget(args))) return orig.apply(this, args);
    return deny(what)();
  };

/** http.request / get: (url | options, [options], [cb]) */
const httpHost = (args) => {
  const a = args[0];
  if (typeof a === "string" || a instanceof URL) {
    try {
      return new URL(String(a)).hostname;
    } catch {
      return null;
    }
  }
  return a?.hostname ?? (typeof a?.host === "string" ? a.host.split(":")[0] : null);
};
const guardHttp = (orig, what) =>
  function (...args) {
    if (isLoopback(httpHost(args))) return orig.apply(this, args);
    return deny(what)();
  };

globalThis.fetch = deny("fetch");
http.request = guardHttp(http.request, "http.request");
http.get = guardHttp(http.get, "http.get");
https.request = deny("https.request");
https.get = deny("https.get");
net.connect = guardNet(net.connect, "net.connect");
net.createConnection = guardNet(net.createConnection, "net.createConnection");
tls.connect = deny("tls.connect");
const origLookup = dns.lookup;
dns.lookup = function (host, ...rest) {
  if (isLoopback(host)) return origLookup.call(this, host, ...rest);
  return deny("dns.lookup")();
};
dns.resolve = deny("dns.resolve");
