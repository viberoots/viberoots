#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { pickFreePort } from "../scaffolding/lib/webapp-static-hmr.ts";
import type { NixosSharedHostDeployment } from "../../deployments/contract.ts";

const execFileAsync = promisify(execFile);

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
  await execFileAsync("openssl", [
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

export async function startNixosSharedHostPublicServer(opts: {
  deployment: NixosSharedHostDeployment;
  hostRoot?: string;
  fixedRoot?: string;
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await pickFreePort();
  const tls = await writeTlsMaterial(
    opts.tlsRoot || opts.hostRoot || opts.fixedRoot || process.cwd(),
    opts.deployment.providerTarget.hostname,
  );
  const rootForRequest = () =>
    opts.fixedRoot ||
    path.join(
      nixosSharedHostContainerRoot(
        opts.hostRoot || "",
        opts.deployment.providerTarget.containerName,
      ),
      "srv/static-app/live",
    );
  const server = https.createServer({ cert: tls.cert, key: tls.key }, async (req, res) => {
    if ((req.headers.host || "").split(":")[0] !== opts.deployment.providerTarget.hostname) {
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
