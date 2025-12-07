#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("writeImporterProvidersByLang(node) writes header, load line, and AUTO_NODE section", async () => {
  await runInTemp("writer-by-lang-node", async (tmp, $) => {
    // Arrange inputs
    const outFile = "third_party/providers/TARGETS.node.auto";
    const providers = [
      {
        lockfile: "apps/web/pnpm-lock.yaml",
        importer: "apps/web",
        patchPaths: ["apps/web/patches/node/lodash@4.17.21.patch"],
      },
    ];
    // Create a small runner so execution happens inside the temp repo env
    const runner = `#!/usr/bin/env zx-wrapper
import { writeImporterProvidersByLang } from "./tools/lib/provider-writer.ts";
const lang = process.env.LANG || "node";
const outFile = process.env.OUT_FILE || "third_party/providers/TARGETS.node.auto";
const providers = JSON.parse(process.env.PROVIDERS_JSON || "[]");
await writeImporterProvidersByLang(lang, providers, { outFile });
`;
    const runnerPath = path.join(tmp, "run-writer.mjs");
    await fsp.writeFile(runnerPath, runner, "utf8");
    // Act: run writer inside temp repo
    await $`LANG=node OUT_FILE=${outFile} PROVIDERS_JSON=${JSON.stringify(providers)} node ${runnerPath}`;
    const txt1 = await fsp.readFile(path.join(tmp, outFile), "utf8");
    const curated = await fsp.readFile(path.join(tmp, "third_party/providers/TARGETS"), "utf8");
    // Assert: header and load line present
    assert.match(txt1, /# GENERATED FILE — DO NOT EDIT\./);
    assert.match(txt1, /load\("\/\/third_party\/providers:defs_node\.bzl", "node_importer_deps"\)/);
    // Assert: entry lines use node_importer_deps(...) form
    assert.match(txt1, /node_importer_deps\(name="/);
    // Assert: curated TARGETS contains AUTO_NODE block
    assert.match(curated, /# BEGIN AUTO_NODE/);
    assert.match(curated, /# END AUTO_NODE/);
    // Idempotency: run writer again and verify no changes
    await $`LANG=node OUT_FILE=${outFile} PROVIDERS_JSON=${JSON.stringify(providers)} node ${runnerPath}`;
    const txt2 = await fsp.readFile(path.join(tmp, outFile), "utf8");
    assert.equal(txt2, txt1, "writer-by-lang must be idempotent");
  });
});
