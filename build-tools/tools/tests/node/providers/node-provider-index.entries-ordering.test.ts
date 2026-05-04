#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../../lib/test-helpers";

test("readNodeProviderIndexEntries returns stable, ordered provider entries", async () => {
  await runInTemp("node-provider-index", async (tmp, $) => {
    await $`git init`;

    const webLf = path.join(tmp, "projects/apps/web/pnpm-lock.yaml");
    const apiLf = path.join(tmp, "projects/apps/api/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(webLf), { recursive: true });
    await fsp.mkdir(path.dirname(apiLf), { recursive: true });
    await fsp.writeFile(
      webLf,
      `lockfileVersion: "9.0"\nimporters:\n  projects/apps/web:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await fsp.writeFile(
      apiLf,
      `lockfileVersion: "9.0"\nimporters:\n  projects/apps/api:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await $`git add projects/apps/web/pnpm-lock.yaml projects/apps/api/pnpm-lock.yaml`;

    // Invoke readNodeProviderIndexEntries inside the temp repo process so git ls-files
    // and dynamic import('yaml') resolve correctly relative to the temp CWD.
    const { stdout } = await $({ stdio: "pipe" })`node -e ${`
        import { readNodeProviderIndexEntries } from './build-tools/tools/buck/providers/node';
        const rows = await readNodeProviderIndexEntries();
        console.log(JSON.stringify(rows));
      `.trim()}`;
    const entries: Array<{ provider: string; key: string }> = JSON.parse(
      String(stdout || "").trim() || "[]",
    );

    if (!Array.isArray(entries) || entries.length < 2) {
      console.error("Expected at least two provider index entries");
      process.exit(2);
    }

    // Verify ordering is ascending by provider name
    const names = entries.map((e) => e.provider);
    const sorted = [...names].sort();
    if (names.join("\n") !== sorted.join("\n")) {
      console.error("Provider entries are not sorted deterministically");
      process.exit(2);
    }

    // Verify keys are of the form lockfile:<path>#<importer>
    for (const e of entries) {
      if (!e.key.startsWith("lockfile:")) {
        console.error("Invalid key in provider index:", e.key);
        process.exit(2);
      }
      if (!/\.yaml#/.test(e.key)) {
        console.error("Provider key missing importer suffix:", e.key);
        process.exit(2);
      }
      if (!e.provider.startsWith("lf_")) {
        console.error("Provider name does not follow lf_* convention:", e.provider);
        process.exit(2);
      }
    }
  });
});
