#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
const $ = globalThis.$;
import { runSprinkleRefCheck } from "../../deployments/sprinkleref-check";

test("check classifies control-plane token refs as secret or runtime credentials", async () => {
  const dir = await gitRepo();
  const secretRef = "secret://control-plane/mini/service-token";
  const runtimeRef = "runtime://github-actions/control-plane-token";
  await writeTracked(dir, "projects/config/shared.json", sharedConfig(secretRef, runtimeRef));
  const output = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--format", "json"],
      stdout: (text) => (output = text),
    });
    assert.equal(exitCode, 1);
    return output;
  });
  const report = JSON.parse(output);
  const byRef = new Map(report.refs.map((entry: any) => [entry.ref, entry]));
  assert.equal(byRef.get(secretRef)?.scheme, "secret");
  assert.equal(byRef.get(secretRef)?.sensitive, true);
  assert.equal(byRef.get(runtimeRef)?.scheme, "runtime");
  assert.equal(byRef.get(runtimeRef)?.status, "declared");
  assert(!report.refs.some((entry: any) => entry.ref.includes("controlPlaneTokenRef")));
  assert(!report.refs.some((entry: any) => entry.scheme === "config"));
});

function sharedConfig(secretRef: string, runtimeRef: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: "viberoots-project-config@1",
      controlPlanes: {
        mini: profile("https://deploy.apps.kilty.io", secretRef),
        ci: profile("https://ci.deploy.apps.kilty.io", runtimeRef),
      },
      sprinkleref: {
        version: 1,
        defaultCategory: "main",
        categories: { main: { backend: "local-file", file: "missing.json" } },
      },
    },
    null,
    2,
  )}\n`;
}

function profile(controlPlaneUrl: string, controlPlaneTokenRef: string) {
  return {
    serviceClient: { controlPlaneUrl, controlPlaneTokenRef },
    records: { backend: "service" },
  };
}

async function gitRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-control-plane-"));
  await $({ cwd: dir })`git init`.quiet();
  return dir;
}

async function writeTracked(dir: string, file: string, text: string) {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text);
  await $({ cwd: dir })`git add ${file}`.quiet();
}

async function runInDir<T>(dir: string, fn: () => Promise<T>) {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
