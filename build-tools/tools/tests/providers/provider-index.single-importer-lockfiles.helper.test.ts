#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("readImporterProviderIndexEntriesForSingleImporterLockfiles returns stable entries for pnpm-lock.yaml and uv.lock", async () => {
  await runInTemp("provider-index-single-importer-lockfiles", async (tmp, $) => {
    await $`git init`;

    const webPnpm = path.join(tmp, "apps/web/pnpm-lock.yaml");
    const apiPnpm = path.join(tmp, "apps/api/pnpm-lock.yaml");
    const webUv = path.join(tmp, "apps/web/uv.lock");
    const apiUv = path.join(tmp, "apps/api/uv.lock");
    await fsp.mkdir(path.dirname(webPnpm), { recursive: true });
    await fsp.mkdir(path.dirname(apiPnpm), { recursive: true });
    await fsp.writeFile(
      webPnpm,
      `lockfileVersion: "9.0"\nimporters:\n  apps/web:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await fsp.writeFile(
      apiPnpm,
      `lockfileVersion: "9.0"\nimporters:\n  apps/api:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await fsp.writeFile(webUv, "", "utf8");
    await fsp.writeFile(apiUv, "", "utf8");
    await $`git add apps/web/pnpm-lock.yaml apps/api/pnpm-lock.yaml apps/web/uv.lock apps/api/uv.lock`;

    const { stdout } = await $({ stdio: "pipe" })`node -e ${`
        import { readImporterProviderIndexEntriesForSingleImporterLockfileBasenames } from './build-tools/tools/lib/provider-index.ts';

        const pnpm = await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
          lockfileBasenames: ['pnpm-lock.yaml'],
          requireNodeModule: 'yaml',
          onMissingRequiredModule: 'throw',
        });

        const uv = await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
          lockfileBasenames: ['uv.lock'],
        });

        console.log(JSON.stringify({ pnpm, uv }));
      `.trim()}`;

    const parsed: {
      pnpm: Array<{ provider: string; key: string }>;
      uv: Array<{ provider: string; key: string }>;
    } = JSON.parse(String(stdout || "").trim() || "{}");

    const check = (entries: Array<{ provider: string; key: string }>, ext: string) => {
      if (!Array.isArray(entries) || entries.length < 2) {
        console.error("Expected at least two provider index entries for", ext);
        process.exit(2);
      }
      const names = entries.map((e) => e.provider);
      const sorted = [...names].sort();
      if (names.join("\n") !== sorted.join("\n")) {
        console.error("Provider entries are not sorted deterministically for", ext);
        process.exit(2);
      }
      for (const e of entries) {
        if (!e.key.startsWith("lockfile:")) {
          console.error("Invalid key in provider index:", e.key);
          process.exit(2);
        }
        if (!new RegExp(`\\.${ext}#`).test(e.key)) {
          console.error("Provider key missing importer suffix:", e.key);
          process.exit(2);
        }
        if (!e.provider.startsWith("lf_")) {
          console.error("Provider name does not follow lf_* convention:", e.provider);
          process.exit(2);
        }
      }
    };

    check(parsed.pnpm, "yaml");
    check(parsed.uv, "lock");
  });
});
