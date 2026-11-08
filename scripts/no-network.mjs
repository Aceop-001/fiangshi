// Preload (node --import) that makes any outbound network attempt throw.
// Used by `npm run accept` for itself and every child process it spawns.
// Local IPC (named pipes / unix sockets, used by tooling such as tsx) stays allowed: it is not network.
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

const isLocalIpc = (a) => (typeof a === "string" && !/^\d+$/.test(a)) || (a && typeof a === "object" && typeof a.path === "string");
const guardNet = (orig, what) =>
  function (...args) {
    if (isLocalIpc(args[0])) return orig.apply(this, args);
    return deny(what)();
  };

globalThis.fetch = deny("fetch");
http.request = deny("http.request");
http.get = deny("http.get");
https.request = deny("https.request");
https.get = deny("https.get");
net.connect = guardNet(net.connect, "net.connect");
net.createConnection = guardNet(net.createConnection, "net.createConnection");
tls.connect = deny("tls.connect");
dns.lookup = deny("dns.lookup");
dns.resolve = deny("dns.resolve");
