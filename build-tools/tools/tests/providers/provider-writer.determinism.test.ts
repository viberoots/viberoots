#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { withScopedEnv } from "../lib/test-helpers/scoped-env";

test("provider-writer: deterministic output and managed section sync", async () => {
  await runInTemp("provider-writer-determinism", async (tmp, $) => {
    // Synthesize two importers pointing at a fake lockfile to exercise sorting/dedupe
    const lockA = "apps/a/pnpm-lock.yaml";
    const lockB = "apps/b/pnpm-lock.yaml";
    await fsp.mkdir(path.join(tmp, "apps", "a"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "apps", "b"), { recursive: true });
    await fsp.writeFile(path.join(tmp, lockA), "lockfileVersion: '9.0'\n", "utf8");
    await fsp.writeFile(path.join(tmp, lockB), "lockfileVersion: '9.0'\n", "utf8");

    // Import the helper from the temp repo
    const mod = await import(path.join(tmp, "build-tools/tools/lib/provider-writer.ts"));
    const { writeImporterProviders } = mod as any;
    const providers = [
      { lockfile: lockA, importer: "apps/a", patchPaths: ["apps/a/patches/node/x@1.0.0.patch"] },
      { lockfile: lockB, importer: "apps/b", patchPaths: [] },
    ];
    const outFile = ".viberoots/workspace/providers/TARGETS.test.auto";
    const ruleLoad = 'load("//:defs_node.bzl", "node_importer_deps")';
    const ruleName = "node_importer_deps";

    await withScopedEnv({ WORKSPACE_ROOT: tmp }, async () => {
      // First write
      await writeImporterProviders(providers, {
        outFile,
        ruleLoad,
        ruleName,
        autoSection: {
          begin: "# BEGIN AUTO_TEST",
          end: "# END AUTO_TEST",
          header: ruleLoad,
        },
      });
      const out1 = await fsp.readFile(path.join(tmp, outFile), "utf8");
      const h1 = crypto.createHash("sha256").update(out1).digest("hex");

      // Second write (no-op expected)
      await writeImporterProviders(providers, {
        outFile,
        ruleLoad,
        ruleName,
        autoSection: {
          begin: "# BEGIN AUTO_TEST",
          end: "# END AUTO_TEST",
          header: ruleLoad,
        },
      });
      const out2 = await fsp.readFile(path.join(tmp, outFile), "utf8");
      const h2 = crypto.createHash("sha256").update(out2).digest("hex");

      if (h1 !== h2 || out1 !== out2) {
        console.error("provider-writer output changed between runs");
        process.exit(2);
      }

      const curated = await fsp.readFile(
        path.join(tmp, ".viberoots/workspace/providers/TARGETS"),
        "utf8",
      );
      if (!curated.includes("# BEGIN AUTO_TEST") || !curated.includes("# END AUTO_TEST")) {
        console.error("expected managed section markers in curated TARGETS");
        process.exit(2);
      }
      if (!curated.includes("node_importer_deps(")) {
        console.error("expected at least one provider rule in managed section");
        process.exit(2);
      }
    });
  });
});
