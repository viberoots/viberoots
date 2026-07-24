import fsp from "node:fs/promises";
import path from "node:path";

export async function stageFreshCloneConsistencyEntrypoint(sourceRoot: string): Promise<void> {
  const devRoot = path.join(sourceRoot, "build-tools", "tools", "dev");
  const entrypoint = path.join(devRoot, "consumer-consistency-check.ts");
  const delegate = path.join(devRoot, "consumer-consistency-check.fixture-production.ts");
  await fsp.rename(entrypoint, delegate);
  await fsp.writeFile(
    entrypoint,
    `#!/usr/bin/env zx-wrapper
import { checkConsumerConsistency } from "./consumer-consistency-check.fixture-production";
import { discoverImportersWithLock } from "./install/importers";
import { assertImporterLockfileFresh } from "./update-pnpm-hash/importer-lockfile";

try {
  await checkConsumerConsistency(process.cwd(), {
    checkPnpm: async (repoRoot) => {
      for (const importer of await discoverImportersWithLock(repoRoot, { cwd: repoRoot })) {
        await assertImporterLockfileFresh({ repoRoot, importer });
      }
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
`,
  );
}
