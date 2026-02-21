#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { formatRunnableLine, inferRunnableFromOutPath } from "../../lib/runnables.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { assertSsrAdapterConformance } from "../lib/ssr-adapter-conformance.ts";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function pickFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  server.close();
  if (!addr || typeof addr !== "object" || typeof addr.port !== "number") {
    throw new Error("failed to reserve an ephemeral port");
  }
  return addr.port;
}

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function nixBuildOutPath(
  tmp: string,
  attr: string,
  _$: any,
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const graphJson = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
  const built = await _$({
    cwd: tmp,
    stdio: "pipe",
    env: { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1", BUCK_GRAPH_JSON: graphJson, ...extraEnv },
  })`bash --noprofile --norc -c ${`set -euo pipefail; nix build "${tmp}#${attr}" --impure --no-link --accept-flake-config --builders "" --print-build-logs --print-out-paths`}`;
  return (
    String(built.stdout || "")
      .trim()
      .split("\n")
      .pop() || ""
  );
}

async function runExpressDockerSmoke(runtimeRoot: string, marker: string): Promise<void> {
  const port = await pickFreePort();
  const child = spawn("node", ["dist/server/index.js"], {
    cwd: runtimeRoot,
    stdio: "pipe",
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "" },
  });
  let stderrText = "";
  child.stderr?.on("data", (chunk) => {
    stderrText += String(chunk || "");
  });
  try {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      if (child.exitCode != null) {
        throw new Error(
          `runtime smoke exited early (code=${child.exitCode})\n${stderrText.trim() || "(no stderr)"}`,
        );
      }
      try {
        const res = await httpGet(`http://127.0.0.1:${port}/`);
        if (res.status === 200 && res.body.includes(marker)) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`runtime smoke did not serve expected marker\n${stderrText.trim()}`);
  } finally {
    try {
      if (child.pid) child.kill("SIGINT");
    } catch {}
    try {
      await Promise.race([once(child, "exit"), sleep(5000)]);
    } catch {}
    if (child.exitCode == null) {
      try {
        if (child.pid) child.kill("SIGKILL");
      } catch {}
    }
  }
}

test(
  "PR-4 SSR contracts: materialize listing, adapter conformance, and Docker startup shape",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS =
        "build-tools toolchains third_party/providers prelude patches docs METHODOLOGY.XML AI-PREFERENCES.XML";
    }

    try {
      await runInTemp("node-webapp-ssr-pr4-contracts", async (tmp, _$) => {
        const $ = _$({ cwd: tmp, stdio: "inherit" });
        await $`scaf new node webapp-ssr-express demo-ssr-express --yes --no-tests`;
        await $`scaf new node webapp-ssr-next demo-ssr-next --yes --no-tests`;

        await _$({
          cwd: path.join(tmp, "projects", "apps", "demo-ssr-express"),
          stdio: "inherit",
        })`zx-wrapper ../../../build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;
        await _$({
          cwd: path.join(tmp, "projects", "apps", "demo-ssr-next"),
          stdio: "inherit",
        })`zx-wrapper ../../../build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;

        await _$({
          cwd: tmp,
          stdio: "pipe",
        })`git add -A projects/apps/demo-ssr-express projects/apps/demo-ssr-next build-tools/tools/nix/node-modules.hashes.json build-tools/tools/nix/langs.nix build-tools/lang/importer_roots.bzl build-tools/tools/buck third_party/providers`;

        await _$({
          cwd: tmp,
          stdio: "inherit",
          env: { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" },
        })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile projects/apps/demo-ssr-express/pnpm-lock.yaml`;
        await _$({
          cwd: tmp,
          stdio: "inherit",
          env: { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" },
        })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile projects/apps/demo-ssr-next/pnpm-lock.yaml`;
        await _$({
          cwd: tmp,
          stdio: "inherit",
        })`zx-wrapper build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

        const selectedOutPaths = new Map<string, string>();
        for (const [label, framework] of [
          ["//projects/apps/demo-ssr-express:app", "express"],
          ["//projects/apps/demo-ssr-next:app", "next"],
        ] as const) {
          const selectedOut = await nixBuildOutPath(tmp, "graph-generator-pure-selected", _$, {
            BUCK_TARGET: label,
          });
          assert.ok(selectedOut, `expected selected graph out path for ${label}`);
          selectedOutPaths.set(label, selectedOut);
          const importer = label.replace(/^\/\//, "").replace(/:app$/, "");
          const runnable = await inferRunnableFromOutPath({
            label,
            outPath: selectedOut,
            importer,
            mode: "ssr",
            framework,
          });
          assert.ok(runnable, `missing runnable contract for ${label}`);
          assert.equal(runnable?.kind, "webapp-ssr");
          assert.equal(runnable?.framework, framework);
          assert.equal(runnable?.run.prod.argv[0], "node");
          const clientContractRoot =
            framework === "next"
              ? path.join(selectedOut, "dist", "client", "public")
              : path.join(selectedOut, "dist", "client");
          await fsp.access(path.join(clientContractRoot, "top.wasm"));
          await fsp.access(path.join(clientContractRoot, "wasm-inline", "index.js"));
          const line = formatRunnableLine({ label, runnable } as any);
          assert.ok(line.includes(label));
          assert.ok(line.includes("[webapp-ssr]"));
          assert.ok(line.includes("node "));
        }

        const expressImporter = "projects/apps/demo-ssr-express";
        const nextImporter = "projects/apps/demo-ssr-next";
        const expressOutPath = selectedOutPaths.get("//projects/apps/demo-ssr-express:app") || "";
        const nextOutPath = selectedOutPaths.get("//projects/apps/demo-ssr-next:app") || "";
        assert.ok(expressOutPath, "expected express out path");
        assert.ok(nextOutPath, "expected next out path");

        await assertSsrAdapterConformance({
          label: "//projects/apps/demo-ssr-express:app",
          outPath: expressOutPath,
          importer: expressImporter,
          framework: "express",
        });
        await assertSsrAdapterConformance({
          label: "//projects/apps/demo-ssr-next:app",
          outPath: nextOutPath,
          importer: nextImporter,
          framework: "next",
        });

        const expressAppAbs = path.join(tmp, expressImporter);
        await _$({
          cwd: expressAppAbs,
          stdio: "inherit",
          env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
        })`pnpm install --frozen-lockfile --ignore-workspace --reporter=append-only`;

        const runtimeRoot = path.join(tmp, "docker-runtime-express");
        await fsp.mkdir(runtimeRoot, { recursive: true });
        await fsp.cp(path.join(expressOutPath, "dist"), path.join(runtimeRoot, "dist"), {
          recursive: true,
        });
        await fsp.symlink(
          path.join(expressAppAbs, "node_modules"),
          path.join(runtimeRoot, "node_modules"),
        );
        await runExpressDockerSmoke(runtimeRoot, 'data-ssr-marker="express"');
      });
    } finally {
      if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = prevRoots;
    }
  },
);
