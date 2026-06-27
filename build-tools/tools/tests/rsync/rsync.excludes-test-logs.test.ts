#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function withDefaultRsyncCopy(fn: () => Promise<void>): Promise<void> {
  const prevGoOnly = process.env.TEST_PARTIAL_CLONE_GO_ONLY;
  process.env.TEST_PARTIAL_CLONE_GO_ONLY = "1";
  try {
    await fn();
  } finally {
    if (prevGoOnly === undefined) delete process.env.TEST_PARTIAL_CLONE_GO_ONLY;
    else process.env.TEST_PARTIAL_CLONE_GO_ONLY = prevGoOnly;
  }
}

async function exists(p: string): Promise<boolean> {
  return await fsp
    .access(p)
    .then(() => true)
    .catch(() => false);
}

async function withRsyncOverlayRoot(fn: (overlayRoot: string) => Promise<void>): Promise<void> {
  const overlayRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-rsync-overlay-"));
  const prevOverlayRoot = process.env.TEST_RSYNC_OVERLAY_ROOT;
  try {
    process.env.TEST_RSYNC_OVERLAY_ROOT = overlayRoot;
    await fn(overlayRoot);
  } finally {
    if (prevOverlayRoot === undefined) delete process.env.TEST_RSYNC_OVERLAY_ROOT;
    else process.env.TEST_RSYNC_OVERLAY_ROOT = prevOverlayRoot;
    await fsp.rm(overlayRoot, { recursive: true, force: true });
  }
}

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
