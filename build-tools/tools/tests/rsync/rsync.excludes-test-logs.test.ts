#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { rsyncRepoTo, runInTemp } from "../lib/test-helpers";
import {
  assertMissing,
  exists,
  generatedViberootsRoots,
  generatedWorkspaceRoots,
  makeSourceRoot,
  makeViberootsSourceRoot,
  withDefaultRsyncCopy,
  withEnv,
  withRsyncOverlayRoot,
} from "./rsync.excludes-test-logs.helpers";

test("rsync: excludes test-logs by default", async () => {
  await withDefaultRsyncCopy(async () => {
    await runInTemp("rsync-excludes-test-logs", async (tmp, $) => {
      const p = path.join(tmp, "test-logs");
      if (await exists(p)) {
        console.error("expected test-logs to be excluded from temp copy, but it exists:", p);
        process.exit(2);
      }
    });
  });
});

test("rsync: excludes nested agent worktree build output", async () => {
  const marker = `rsync-agent-output-${process.pid}`;
  const codexRoot = path.join(".codex", "worktrees", marker);
  const claudeRoot = path.join(".claude", "worktrees", marker);
  await withRsyncOverlayRoot(async (overlayRoot) => {
    await fsp.mkdir(path.join(overlayRoot, codexRoot, "buck-out", ".unified-pnpm-store"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(overlayRoot, claudeRoot, "buck-out", "test-logs"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(overlayRoot, codexRoot, "buck-out", ".unified-pnpm-store", "blob"),
      "x",
    );
    await fsp.writeFile(path.join(overlayRoot, claudeRoot, "buck-out", "test-logs", "log"), "x");
    await withDefaultRsyncCopy(async () => {
      await runInTemp("rsync-excludes-agent-worktrees", async (tmp, $) => {
        for (const rel of [codexRoot, claudeRoot]) {
          const p = path.join(tmp, rel);
          if (await exists(p)) {
            console.error("expected agent worktree output to be excluded from temp copy:", p);
            process.exit(2);
          }
        }
      });
    });
  });
  for (const rel of [codexRoot, claudeRoot]) {
    const liveLeakPath = path.join(process.cwd(), rel);
    if (await exists(liveLeakPath)) {
      console.error("test fixture leaked into live repo:", liveLeakPath);
      process.exit(2);
    }
  }
});

test("rsync: filtered roots exclude nested viberoots generated workspace state", async () => {
  const source = await makeSourceRoot("viberoots-rsync-source-");
  const dest = await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-rsync-dest-"));
  try {
    await withEnv(
      {
        TEST_RSYNC_SOURCE_ROOT: source,
        TEST_RSYNC_ROOTS: "viberoots",
      },
      async () => {
        await rsyncRepoTo(dest);
      },
    );
    await fsp.access(path.join(dest, "viberoots", "build-tools", "keep.txt"));
    await assertMissing(path.join(dest, "viberoots", ".viberoots"));
    for (const generatedRoot of generatedViberootsRoots) {
      await assertMissing(path.join(dest, "viberoots", generatedRoot));
    }
    await assertMissing(path.join(dest, "viberoots", ".codex-focused-verify.log"));
    await assertMissing(path.join(dest, "viberoots", ".full-test-output.log"));
    await assertMissing(path.join(dest, "viberoots", ".patch-sessions.json"));
    await assertMissing(path.join(dest, "viberoots", ".live-edit-marker"));
  } finally {
    await fsp.rm(source, { recursive: true, force: true });
    await fsp.rm(dest, { recursive: true, force: true });
  }
});

test("rsync: viberoots source roots exclude generated workspace buck state", async () => {
  const source = await makeViberootsSourceRoot("viberoots-rsync-vbr-source-");
  const dest = await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-rsync-vbr-dest-"));
  try {
    await withEnv(
      {
        TEST_RSYNC_SOURCE_ROOT: source,
        TEST_RSYNC_ROOTS: undefined,
      },
      async () => {
        await rsyncRepoTo(dest);
      },
    );
    await fsp.access(path.join(dest, "build-tools", "keep.txt"));
    await fsp.access(path.join(dest, ".viberoots", "workspace", "flake.nix"));
    for (const generatedRoot of generatedWorkspaceRoots) {
      await assertMissing(path.join(dest, ".viberoots", "workspace", generatedRoot));
    }
    await assertMissing(path.join(dest, ".codex-focused-verify.log"));
    await assertMissing(path.join(dest, ".full-test-output.log"));
    await assertMissing(path.join(dest, ".patch-sessions.json"));
    await assertMissing(path.join(dest, ".source-fingerprint"));
  } finally {
    await fsp.rm(source, { recursive: true, force: true });
    await fsp.rm(dest, { recursive: true, force: true });
  }
});

test("rsync: default copy uses explicit root allowlist", async () => {
  const source = await makeViberootsSourceRoot("viberoots-rsync-allow-source-");
  const dest = await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-rsync-allow-dest-"));
  try {
    await fsp.writeFile(path.join(source, "flake.lock"), "{}\n");
    await fsp.writeFile(path.join(source, "package.json"), "{}\n");
    await fsp.writeFile(path.join(source, "accidental-root.log"), "must not copy\n");
    await fsp.writeFile(path.join(source, "quad-alignment-local.md"), "must not copy\n");

    await withEnv(
      {
        TEST_RSYNC_SOURCE_ROOT: source,
        TEST_RSYNC_ROOTS: undefined,
      },
      async () => {
        await rsyncRepoTo(dest);
      },
    );

    await fsp.access(path.join(dest, "flake.nix"));
    await fsp.access(path.join(dest, "flake.lock"));
    await fsp.access(path.join(dest, "package.json"));
    await fsp.access(path.join(dest, "build-tools", "keep.txt"));
    await assertMissing(path.join(dest, "accidental-root.log"));
    await assertMissing(path.join(dest, "quad-alignment-local.md"));
    await assertMissing(path.join(dest, ".source-fingerprint"));
  } finally {
    await fsp.rm(source, { recursive: true, force: true });
    await fsp.rm(dest, { recursive: true, force: true });
  }
});

test("rsync: excludes nested buck-out directories by name", async () => {
  const marker = `rsync-nested-buck-out-${process.pid}`;
  const nestedBuckOut = path.join("projects", "apps", marker, "nested", "buck-out");
  const liveLeakPath = path.join(process.cwd(), nestedBuckOut);
  await withRsyncOverlayRoot(async (overlayRoot) => {
    const overlayNestedBuckOut = path.join(overlayRoot, nestedBuckOut);
    await fsp.mkdir(overlayNestedBuckOut, { recursive: true });
    await fsp.writeFile(path.join(overlayNestedBuckOut, "artifact"), "x");
    await withDefaultRsyncCopy(async () => {
      await runInTemp("rsync-excludes-nested-buck-out", async (tmp, $) => {
        const p = path.join(tmp, nestedBuckOut);
        if (await exists(p)) {
          console.error("expected nested buck-out to be excluded from temp copy:", p);
          process.exit(2);
        }
      });
    });
  });
  if (await exists(liveLeakPath)) {
    console.error("test fixture leaked into live repo:", liveLeakPath);
    process.exit(2);
  }
});
