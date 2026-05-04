#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

process.env.TEST_NEED_DEV_ENV = "1";
process.env.NIX_PNPM_ALLOW_GENERATE = "1";
process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "600";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test("ts service scaffold creates a deployable Node service shape", async () => {
  await runInTemp("node-service-scaffold-contract", async (tmp, $) => {
    await $({ cwd: tmp })`scaf new ts service demo-service --yes --skip-lockfile-gen`;
    const root = path.join(tmp, "projects", "apps", "demo-service");
    const targets = await fsp.readFile(path.join(root, "TARGETS"), "utf8");
    assert.match(targets, /node_service_artifact/);
    const runtime = JSON.parse(await fsp.readFile(path.join(root, "service.runtime.json"), "utf8"));
    assert.equal(runtime.schemaVersion, "node-service-runtime@1");
    assert.equal(runtime.health.path, "/healthz");
    const source = await fsp.readFile(path.join(root, "src", "index.ts"), "utf8");
    assert.match(source, /createServer/);
    assert.match(source, /\/healthz/);
  });
});

test(
  "ts service scaffold builds artifact and runs generated tests",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("node-service-scaffold-build", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      const importer = "projects/apps/demo-service";
      const attr = "projects-apps-demo-service";
      const timeoutSecs = String(
        Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200"),
      );

      await $`git init`;
      await $`scaf new ts service demo-service --yes`;
      await $`bash --noprofile --norc -c 'set -euo pipefail; git -C ${tmp} config user.email test@example.com; git -C ${tmp} config user.name test; git -C ${tmp} add -A; git -C ${tmp} commit -m scaffold'`;
      await $({
        stdio: "inherit",
      })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${importer}/pnpm-lock.yaml`;

      const buildAttr = async (name: string) => {
        const cmd = `set -euo pipefail; timeout ${timeoutSecs}s nix build "${tmp}#${name}.${attr}" --impure --no-link --accept-flake-config --builders "" --print-out-paths`;
        const result = await $({ stdio: "pipe" })`bash --noprofile --norc -c ${cmd}`;
        const outPath = String(result.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop();
        assert.ok(outPath, `nix build returned an out path for ${name}`);
        return outPath;
      };

      const serviceOut = await buildAttr("node-service");
      await fsp.access(path.join(serviceOut, "runtime-contract.json"));
      await fsp.access(path.join(serviceOut, "artifact-identity.json"));
      const testOut = await buildAttr("node-test");
      assert.ok((await fsp.readdir(path.join(testOut, "report"))).length > 0);
    });
  },
);
