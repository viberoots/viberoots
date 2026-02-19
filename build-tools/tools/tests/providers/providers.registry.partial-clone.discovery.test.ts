#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

async function removeLockfilesRecursively(root: string): Promise<void> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Array<any> = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true } as any);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name === "pnpm-lock.yaml" || entry.name === "uv.lock") {
        await fsp.rm(full, { force: true });
      }
    }
  }
}

test("providers registry: partial-clone with no enabled languages runs without errors", async () => {
  process.env.TEST_PARTIAL_CLONE_GO_ONLY = "1";
  await runInTemp("providers-registry-partial", async (tmp, $) => {
    // Ensure providers dir exists (curated auto section lives here in real repos)
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    // This test asserts the "no enabled languages" case. The workspace copy may include
    // repo-root lockfiles (e.g. pnpm-lock.yaml) used for tooling; remove them so discovery
    // does not enable Node/Python in this partial clone.
    await fsp.rm(path.join(tmp, "pnpm-lock.yaml"), { force: true });
    await fsp.rm(path.join(tmp, "uv.lock"), { force: true });
    await removeLockfilesRecursively(tmp);
    // Run without --lang so discovery uses manifest + requiredPaths gating.
    await $({ cwd: tmp, stdio: "inherit" })`node build-tools/tools/buck/sync-providers.ts`;
    // With no enabled languages present, provider files must be empty (header-only) if present.
    const provDir = path.join(tmp, "third_party", "providers");
    for (const [file, marker] of [
      ["TARGETS.node.auto", "node_importer_deps("],
      ["TARGETS.python.auto", "python_importer_deps("],
    ] as Array<[string, string]>) {
      const p = path.join(provDir, file);
      if (await exists(p)) {
        const txt = await fsp.readFile(p, "utf8").catch(() => "");
        assert.ok(
          !txt.includes(marker),
          `expected ${file} to be header-only (no ${marker} entries)`,
        );
      }
    }
  });
});
