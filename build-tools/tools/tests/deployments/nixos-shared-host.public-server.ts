#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime";
import { startStaticWebappHttpsServer } from "./static-webapp.https-server";
import { pickFreePort } from "../scaffolding/lib/webapp-static-hmr";

async function waitForHttpReady(opts: {
  port: number;
  pathName: string;
  child: ReturnType<typeof spawn>;
  stderrChunks: string[];
  stdoutChunks: string[];
}): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (opts.child.exitCode !== null) {
      const details = [opts.stderrChunks.join(""), opts.stdoutChunks.join("")]
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
      throw new Error(
        `SSR test server exited before becoming ready (exit ${opts.child.exitCode})${
          details ? `: ${details}` : ""
        }`,
      );
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: opts.port,
            path: opts.pathName,
            method: "GET",
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve());
          },
        );
        req.on("error", reject);
        req.end();
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`SSR test server did not become ready on 127.0.0.1:${opts.port}`);
}

export async function startNixosSharedHostPublicServer(opts: {
  deployment: NixosSharedHostDeployment;
  hostRoot?: string;
  fixedRoot?: string;
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  if (opts.deployment.component.kind === "ssr-webapp") {
    const liveRoot = path.resolve(
      opts.fixedRoot ||
        path.join(
          nixosSharedHostContainerRoot(
            opts.hostRoot || "",
            opts.deployment.providerTarget.containerName,
          ),
          "srv/ssr-app/live",
        ),
    );
    const serverEntry = path.join(liveRoot, "dist/server/index.js");
    await fsp.access(serverEntry);
    const port = await pickFreePort();
    const child = spawn(process.execPath, [serverEntry], {
      cwd: liveRoot,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      stdio: "pipe",
    });
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => stdoutChunks.push(String(chunk)));
    const readinessPath =
      opts.deployment.components[0]?.runtime.healthPath ||
      opts.deployment.runtime?.healthPath ||
      "/";
    await waitForHttpReady({ port, pathName: readinessPath, child, stderrChunks, stdoutChunks });
    return {
      port,
      close: async () => {
        if (child.exitCode !== null) return;
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      },
    };
  }
  return await startStaticWebappHttpsServer({
    hostname: opts.deployment.providerTarget.hostname,
    root: () =>
      opts.fixedRoot ||
      path.join(
        nixosSharedHostContainerRoot(
          opts.hostRoot || "",
          opts.deployment.providerTarget.containerName,
        ),
        "srv/static-app/live",
      ),
    tlsRoot: opts.tlsRoot || opts.hostRoot || opts.fixedRoot,
  });
}
