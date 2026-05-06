#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { pickFreePort } from "../scaffolding/lib/webapp-static-hmr";
import { STATIC_WEBAPP_TEST_CERT, STATIC_WEBAPP_TEST_KEY } from "./static-webapp.tls-fixture";

async function serveFile(
  root: string,
  pathname: string,
): Promise<{ status: number; body: string }> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const abs = path.resolve(root, rel);
  const prefix = path.resolve(root) + path.sep;
  if (abs !== path.resolve(root, "index.html") && !abs.startsWith(prefix)) {
    return { status: 404, body: "not found\n" };
  }
  try {
    return { status: 200, body: await fsp.readFile(abs, "utf8") };
  } catch {
    return { status: 404, body: "not found\n" };
  }
}

export async function startStaticWebappHttpsServer(opts: {
  hostname: string;
  root: string | (() => string);
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await pickFreePort();
  const rootForRequest = () => (typeof opts.root === "function" ? opts.root() : opts.root);
  const server = https.createServer(
    { cert: STATIC_WEBAPP_TEST_CERT, key: STATIC_WEBAPP_TEST_KEY },
    async (req, res) => {
      if ((req.headers.host || "").split(":")[0] !== opts.hostname) {
        res.writeHead(404).end("unknown host\n");
        return;
      }
      const response = await serveFile(rootForRequest(), req.url || "/");
      res.writeHead(response.status, { "content-type": "text/html; charset=utf-8" });
      res.end(response.body);
    },
  );
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function startStaticWebappHttpsMultiServer(opts: {
  hosts: Record<string, string | (() => string)>;
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const hostnames = Object.keys(opts.hosts).sort();
  if (hostnames.length === 0) throw new Error("multi-host server requires at least one host");
  const port = await pickFreePort();
  const server = https.createServer(
    { cert: STATIC_WEBAPP_TEST_CERT, key: STATIC_WEBAPP_TEST_KEY },
    async (req, res) => {
      const hostname = (req.headers.host || "").split(":")[0];
      const root = opts.hosts[hostname];
      if (!root) {
        res.writeHead(404).end("unknown host\n");
        return;
      }
      const response = await serveFile(typeof root === "function" ? root() : root, req.url || "/");
      res.writeHead(response.status, { "content-type": "text/html; charset=utf-8" });
      res.end(response.body);
    },
  );
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
