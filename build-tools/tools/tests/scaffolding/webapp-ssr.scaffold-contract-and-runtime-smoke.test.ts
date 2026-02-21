#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function httpGet(
  url: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(
  url: string,
  expectedMarker: string,
  timeoutMs = 45000,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(url);
      if (res.status === 200 && res.body.includes(expectedMarker)) {
        return res;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error(`server did not return expected marker within ${timeoutMs}ms`);
}

async function pickFreePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = srv.address();
  try {
    srv.close();
  } catch {}
  if (typeof addr !== "object" || !addr || typeof addr.port !== "number") {
    throw new Error("failed to allocate free port");
  }
  return addr.port;
}

async function installNodeModules(appAbs: string, _$: any): Promise<void> {
  await _$({
    cwd: appAbs,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  })`pnpm install --frozen-lockfile`;
}

async function assertContractFiles(tmp: string, template: string): Promise<void> {
  const appAbs = path.join(tmp, "projects", "apps", "demo-ssr");
  const expectedCommon = [
    path.join(appAbs, "TARGETS"),
    path.join(appAbs, "package.json"),
    path.join(appAbs, "server", "index.ts"),
    path.join(appAbs, "pnpm-lock.yaml"),
  ];
  for (const p of expectedCommon) {
    if (!(await exists(p))) throw new Error(`expected scaffold file missing: ${p}`);
  }

  if (template === "webapp-ssr-express") {
    for (const p of [
      path.join(appAbs, "src", "entry-client.ts"),
      path.join(appAbs, "src", "entry-server.ts"),
      path.join(appAbs, "vite.config.ts"),
    ]) {
      if (!(await exists(p))) throw new Error(`expected Express SSR file missing: ${p}`);
    }
  } else {
    for (const p of [
      path.join(appAbs, "app", "layout.tsx"),
      path.join(appAbs, "app", "page.tsx"),
      path.join(appAbs, "next.config.mjs"),
    ]) {
      if (!(await exists(p))) throw new Error(`expected Next SSR file missing: ${p}`);
    }
  }
}

async function assertPackageScriptsAndLabels(tmp: string, template: string, framework: string) {
  const appAbs = path.join(tmp, "projects", "apps", "demo-ssr");
  const pkg = JSON.parse(await fsp.readFile(path.join(appAbs, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = pkg.scripts || {};
  assert.equal(typeof scripts["dev:ssr"], "string");
  assert.equal(typeof scripts["build:ssr"], "string");
  assert.equal(typeof scripts["start:ssr"], "string");
  assert.ok(scripts["start:ssr"].startsWith("node "));

  const targetsText = await fsp.readFile(path.join(appAbs, "TARGETS"), "utf8");
  assert.ok(
    targetsText.includes("webapp:ssr"),
    `${template} TARGETS must include webapp:ssr label`,
  );
  assert.ok(
    targetsText.includes(`framework:${framework}`),
    `${template} TARGETS must include framework:${framework} label`,
  );
}

async function runExpressRuntimeSmoke(tmp: string, marker: string, _$: any): Promise<void> {
  const appAbs = path.join(tmp, "projects", "apps", "demo-ssr");
  await installNodeModules(appAbs, _$);
  await _$({
    cwd: appAbs,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  })`pnpm run build:ssr`;

  const port = await pickFreePort();
  const child = spawn("node", ["dist/server/index.js"], {
    cwd: appAbs,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" },
  });
  try {
    const res = await waitForServer(`http://127.0.0.1:${port}/`, marker);
    assert.equal(res.status, 200);
    const serverWasmHeader = Number(String(res.headers["x-server-wasm-bytes"] || "0"));
    assert.ok(serverWasmHeader > 0, "expected x-server-wasm-bytes header from server wasm path");
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, "SIGINT");
    } catch {}
    try {
      await Promise.race([once(child, "exit"), sleep(5000)]);
    } catch {}
    if (child.exitCode == null) {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  }
}

async function runNextRuntimeSmoke(tmp: string, marker: string, _$: any): Promise<void> {
  const appAbs = path.join(tmp, "projects", "apps", "demo-ssr");
  await installNodeModules(appAbs, _$);
  await _$({
    cwd: appAbs,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  })`pnpm run build:ssr`;
  const port = await pickFreePort();
  const child = spawn("node", ["dist/server/index.js"], {
    cwd: appAbs,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "" },
  });
  try {
    const res = await waitForServer(`http://127.0.0.1:${port}/`, marker, 90000);
    assert.equal(res.status, 200);
    const serverWasmHeader = Number(String(res.headers["x-server-wasm-bytes"] || "0"));
    assert.ok(serverWasmHeader > 0, "expected x-server-wasm-bytes header from server wasm path");
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, "SIGINT");
    } catch {}
    try {
      await Promise.race([once(child, "exit"), sleep(5000)]);
    } catch {}
    if (child.exitCode == null) {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  }
}

test(
  "node SSR templates: scaffold contract + runtime smoke",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    process.env.NIX_PNPM_ALLOW_GENERATE = "1";
    await runInTemp("node-webapp-ssr-scaffold-smoke", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      // Runtime smoke validates SSR startup contracts, so skip template test deps to reduce install cost.
      await $`scaf new node webapp-ssr-express demo-ssr --yes --no-tests`;
      await assertContractFiles(tmp, "webapp-ssr-express");
      await assertPackageScriptsAndLabels(tmp, "webapp-ssr-express", "express");
      await runExpressRuntimeSmoke(tmp, 'data-ssr-marker="express"', _$);

      await $`rm -rf projects/apps/demo-ssr`;

      await $`scaf new node webapp-ssr-next demo-ssr --yes --no-tests`;
      await assertContractFiles(tmp, "webapp-ssr-next");
      await assertPackageScriptsAndLabels(tmp, "webapp-ssr-next", "next");
      await runNextRuntimeSmoke(tmp, 'data-ssr-marker="next"', _$);
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
