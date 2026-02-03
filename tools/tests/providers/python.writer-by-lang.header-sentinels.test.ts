#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("writeImporterProvidersByLang(python) writes header, load line, and AUTO_PYTHON section", async () => {
  await runInTemp("writer-by-lang-python", async (tmp, $) => {
    const outFile = "third_party/providers/TARGETS.python.auto";
    const providers = [
      {
        lockfile: "libs/api/uv.lock",
        importer: "libs/api",
        patchPaths: ["libs/api/patches/python/attrs@23.2.0.patch"],
      },
    ];
    const runner = `#!/usr/bin/env zx-wrapper
import { writeImporterProvidersByLang } from "./tools/lib/provider-writer";
const lang = process.env.LANG || "python";
const outFile = process.env.OUT_FILE || "third_party/providers/TARGETS.python.auto";
const providers = JSON.parse(process.env.PROVIDERS_JSON || "[]");
await writeImporterProvidersByLang(lang, providers, { outFile });
`;
    const runnerPath = path.join(tmp, "run-writer.mjs");
    await fsp.writeFile(runnerPath, runner, "utf8");
    await $`LANG=python OUT_FILE=${outFile} PROVIDERS_JSON=${JSON.stringify(providers)} node ${runnerPath}`;
    const txt1 = await fsp.readFile(path.join(tmp, outFile), "utf8");
    const curated = await fsp.readFile(path.join(tmp, "third_party/providers/TARGETS"), "utf8");
    assert.match(txt1, /# GENERATED FILE — DO NOT EDIT\./);
    assert.match(
      txt1,
      /load\("\/\/third_party\/providers:defs_python\.bzl", "python_importer_deps"\)/,
    );
    assert.match(txt1, /python_importer_deps\(name="/);
    assert.match(curated, /# BEGIN AUTO_PYTHON/);
    assert.match(curated, /# END AUTO_PYTHON/);
    await $`LANG=python OUT_FILE=${outFile} PROVIDERS_JSON=${JSON.stringify(providers)} node ${runnerPath}`;
    const txt2 = await fsp.readFile(path.join(tmp, outFile), "utf8");
    assert.equal(txt2, txt1, "writer-by-lang must be idempotent");
  });
});
