#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp, exists } from "../lib/test-helpers";

test("sync-providers exports renamed helpers and they behave as expected (dry-run)", async () => {
  await runInTemp("sync-providers-renamed-helpers", async (tmp, $) => {
    // Ensure providers dir exists so any minimal writes succeed deterministically
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    // Write a tiny harness that imports the module and calls the helpers.
    const outFile = path.join(tmp, "third_party", "providers", "_sync_providers_helpers_out.json");
    const harness = [
      "#!/usr/bin/env zx-wrapper",
      "import fs from 'fs-extra';",
      "globalThis.argv = { emitIndex: false, 'emit-index': false };",
      "const mod = await import('../buck/sync-providers');",
      "const a = mod.targetLangRequested('');",
      "const b = mod.targetLangRequested('node');",
      "const c = mod.emitIndexRequested();",
      "await fs.outputFile(" + JSON.stringify(outFile) + ", JSON.stringify({ a, b, c }));",
      "console.log('OK');",
      "",
    ].join("\n");
    const harnessDir = path.join(tmp, "build-tools", "tools", "scripts");
    const harnessPath = path.join(harnessDir, "sync-providers-import-harness.ts");
    await fsp.mkdir(harnessDir, { recursive: true });
    await fsp.writeFile(harnessPath, harness, "utf8");

    const rel = path.relative(tmp, harnessPath);
    await $`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs ${rel}`.nothrow();
    const existsOut = await exists(outFile);
    if (!existsOut) {
      console.error("harness did not write output file:", outFile);
      process.exit(2);
    }
    const txt = await fsp.readFile(outFile, "utf8");
    let json: any;
    try {
      json = JSON.parse(txt);
    } catch {
      console.error("harness output file is not valid JSON:", txt);
      process.exit(2);
    }
    if (json.a !== false || json.b !== true || json.c !== false) {
      console.error("unexpected helper behavior:", json);
      process.exit(2);
    }

    // Verify minimal glue write occurred deterministically when no lockfiles exist
    const autoTargets = path.join(tmp, "third_party", "providers", "TARGETS.node.auto");
    if (!(await exists(autoTargets))) {
      console.error("expected TARGETS.node.auto to be present after import (minimal header)");
      process.exit(2);
    }
    const contents = await fsp.readFile(autoTargets, "utf8");
    if (!contents.includes("# GENERATED FILE — DO NOT EDIT.")) {
      console.error("TARGETS.node.auto missing header");
      process.exit(2);
    }
  });
});
