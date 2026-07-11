#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pruneStaleUnifiedPnpmStoreEpochs } from "../../dev/unified-pnpm-store-cleanup";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("require-unified-pnpm-store assembles from exact prefetched stores", async () => {
  const txt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/require-unified-pnpm-store.ts"),
    "utf8",
  );
  const cleanupTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/unified-pnpm-store-cleanup.ts"),
    "utf8",
  );
  const epochTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/unified-pnpm-store-epoch.ts"),
    "utf8",
  );
  if (!txt.includes("prepareExactPnpmStore")) {
    throw new Error("require-unified-pnpm-store must prepare exact prefetched stores");
  }
  if (
    !txt.includes("mergeExactStorePathIntoUnifiedStore") ||
    !txt.includes('"store.tar"') ||
    !txt.includes("mergePnpmStore(opts.exactStorePath, opts.unifyStore)")
  ) {
    throw new Error(
      "require-unified-pnpm-store must merge exact store directories and legacy archives into unifyStore",
    );
  }
  if (txt.includes("nix build --impure")) {
    throw new Error("require-unified-pnpm-store must not rebuild pnpm-store attrs during prewarm");
  }
  if (
    !txt.includes("pruneStalePnpmStoreVersions") ||
    !cleanupTxt.includes("pnpmStoreVersionNumber") ||
    !cleanupTxt.includes("fsp.rm(path.join(unifyStore, entry.name)")
  ) {
    throw new Error("require-unified-pnpm-store must prune stale pnpm store-version directories");
  }
  if (
    !txt.includes("pruneStaleUnifiedPnpmStoreEpochs") ||
    !cleanupTxt.includes("pnpmStoreEpochName") ||
    !cleanupTxt.includes("fsp.rm(path.join(stateDir, ent.name)")
  ) {
    throw new Error("require-unified-pnpm-store must prune stale epoch store directories");
  }
  if (!epochTxt.includes("build-tools/tools/dev/unified-pnpm-store-cleanup.ts")) {
    throw new Error("unified pnpm store epoch must include cleanup logic in its digest");
  }
});

test("require-unified-pnpm-store prunes stale epoch siblings only", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-unified-pnpm-store-"));
  try {
    const stateDir = path.join(tmp, ".viberoots", "workspace", "buck", "unified-pnpm-store");
    const active = path.join(stateDir, `store-${"a".repeat(64)}`);
    const stale = path.join(stateDir, `store-${"b".repeat(64)}`);
    const staleAfterOutsideCheck = path.join(stateDir, `store-${"c".repeat(64)}`);
    const nonEpoch = path.join(stateDir, "store-old-local");
    const outsideActive = path.join(tmp, "outside", `store-${"d".repeat(64)}`);
    await fsp.mkdir(path.join(active, "store", "v10"), { recursive: true });
    await fsp.mkdir(path.join(stale, "store", "v10"), { recursive: true });
    await fsp.mkdir(path.join(staleAfterOutsideCheck, "store", "v10"), { recursive: true });
    await fsp.mkdir(nonEpoch, { recursive: true });
    await fsp.mkdir(outsideActive, { recursive: true });
    await fsp.writeFile(path.join(stateDir, "path"), path.join(active, "store") + "\n", "utf8");
    await fsp.writeFile(path.join(stateDir, "require.lock"), "held", "utf8");

    await pruneStaleUnifiedPnpmStoreEpochs({ stateDir, activeUnifyDir: outsideActive });
    await fsp.stat(staleAfterOutsideCheck);

    await pruneStaleUnifiedPnpmStoreEpochs({ stateDir, activeUnifyDir: active });
    await fsp.stat(active);
    await fsp.stat(nonEpoch);
    await fsp.stat(path.join(stateDir, "path"));
    await fsp.stat(path.join(stateDir, "require.lock"));
    await fsp.stat(outsideActive);
    await fsp.stat(stale).then(
      () => {
        throw new Error("stale epoch directory was not removed");
      },
      () => undefined,
    );
    await fsp.stat(staleAfterOutsideCheck).then(
      () => {
        throw new Error("second stale epoch directory was not removed");
      },
      () => undefined,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
