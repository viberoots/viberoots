#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { nixEvalTempDirOutsideWorkspace, pinnedNixpkgsPackageExpr } from "../../lib/pinned-nixpkgs";
import { pickFreePort } from "../scaffolding/lib/webapp-static-hmr";

const execFileAsync = promisify(execFile);
let cachedOpenSslPath: Promise<string> | null = null;

async function pinnedOpenSslPath(): Promise<string> {
  if (cachedOpenSslPath) return await cachedOpenSslPath;
  cachedOpenSslPath = (async () => {
    const repoRoot = process.cwd();
    const expr = pinnedNixpkgsPackageExpr(path.join(repoRoot, "flake.lock"), "pkgs.openssl");
    const { stdout } = await execFileAsync(
      "nix",
      [
        "build",
        "--impure",
        "--accept-flake-config",
        "--expr",
        expr,
        "--no-link",
        "--print-out-paths",
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: nixEvalTempDirOutsideWorkspace(repoRoot),
        },
      },
    );
    const outPath = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!outPath) throw new Error("failed to resolve pinned openssl from workspace flake");
    return path.join(outPath, "bin", "openssl");
  })();
  return await cachedOpenSslPath;
}

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

async function writeTlsMaterial(
  tmpRoot: string,
  hostname: string,
): Promise<{ cert: Buffer; key: Buffer }> {
  const certDir = path.join(tmpRoot, ".tls");
  const keyPath = path.join(certDir, "server.key");
  const certPath = path.join(certDir, "server.crt");
  await fsp.mkdir(certDir, { recursive: true });
  const openssl = await pinnedOpenSslPath();
  await execFileAsync(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-sha256",
    "-days",
    "1",
    "-nodes",
    "-subj",
    `/CN=${hostname}`,
    "-addext",
    `subjectAltName=DNS:${hostname}`,
  ]);
  return {
    cert: await fsp.readFile(certPath),
    key: await fsp.readFile(keyPath),
  };
}

export async function startStaticWebappHttpsServer(opts: {
  hostname: string;
  root: string | (() => string);
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await pickFreePort();
  const tls = await writeTlsMaterial(
    opts.tlsRoot || (typeof opts.root === "string" ? opts.root : process.cwd()),
    opts.hostname,
  );
  const rootForRequest = () => (typeof opts.root === "function" ? opts.root() : opts.root);
  const server = https.createServer({ cert: tls.cert, key: tls.key }, async (req, res) => {
    if ((req.headers.host || "").split(":")[0] !== opts.hostname) {
      res.writeHead(404).end("unknown host\n");
      return;
    }
    const response = await serveFile(rootForRequest(), req.url || "/");
    res.writeHead(response.status, { "content-type": "text/html; charset=utf-8" });
    res.end(response.body);
  });
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
  const tls = await writeTlsMaterial(
    opts.tlsRoot ||
      (typeof opts.hosts[hostnames[0]!] === "string"
        ? (opts.hosts[hostnames[0]!] as string)
        : process.cwd()),
    hostnames[0]!,
  );
  const server = https.createServer({ cert: tls.cert, key: tls.key }, async (req, res) => {
    const hostname = (req.headers.host || "").split(":")[0];
    const root = opts.hosts[hostname];
    if (!root) {
      res.writeHead(404).end("unknown host\n");
      return;
    }
    const response = await serveFile(typeof root === "function" ? root() : root, req.url || "/");
    res.writeHead(response.status, { "content-type": "text/html; charset=utf-8" });
    res.end(response.body);
  });
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
