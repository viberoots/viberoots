#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsDevTool } from "./lib/viberoots-tools";

process.env.TEST_NEED_DEV_ENV = "1";
process.env.NIX_PNPM_ALLOW_GENERATE = "1";
process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "600";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function workspaceFlakeRef(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.nix");
  const hasHidden = await fsp
    .access(hidden)
    .then(() => true)
    .catch(() => false);
  return hasHidden ? path.dirname(hidden) : root;
}

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
      // Nix evaluates the flake at `tmp` by accessing git blob objects as direct
      // loose-object filesystem paths (.git/objects/XY/...). After `git add -A && git
      // commit`, git auto-gc can fire and pack loose blobs — the paths then disappear and
      // Nix evaluation fails with "path '.git/objects/XY/...' does not exist". Suppressing
      // auto-gc in this ephemeral repo keeps every blob loose for the duration of the build.
      await $`git config gc.auto 0`;
      await $`scaf new ts service demo-service --yes`;
      await $`bash --noprofile --norc -c 'set -euo pipefail; git -C ${tmp} config user.email test@example.com; git -C ${tmp} config user.name test; git -C ${tmp} add -A projects/apps/demo-service; git -C ${tmp} commit -m scaffold'`;
      await $({
        stdio: "inherit",
      })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${importer}/pnpm-lock.yaml`;
      await $`git add projects/node-modules.hashes.json`;
      await $`git commit -m update-hashes`.nothrow();
      const flakeRef = await workspaceFlakeRef(tmp);

      const buildAttr = async (name: string) => {
        const cmd = `set -euo pipefail; timeout ${timeoutSecs}s nix build "path:${flakeRef}#${name}.${attr}" --impure --no-link --accept-flake-config --builders "" --print-out-paths`;
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
