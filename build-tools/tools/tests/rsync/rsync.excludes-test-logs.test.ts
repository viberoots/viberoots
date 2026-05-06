#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
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
  await fsp.mkdir(path.join(codexRoot, "buck-out", ".unified-pnpm-store"), { recursive: true });
  await fsp.mkdir(path.join(claudeRoot, "buck-out", "test-logs"), { recursive: true });
  await fsp.writeFile(path.join(codexRoot, "buck-out", ".unified-pnpm-store", "blob"), "x");
  await fsp.writeFile(path.join(claudeRoot, "buck-out", "test-logs", "log"), "x");
  try {
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
  } finally {
    await fsp.rm(codexRoot, { recursive: true, force: true });
    await fsp.rm(claudeRoot, { recursive: true, force: true });
  }
});

test("rsync: excludes nested buck-out directories by name", async () => {
  const marker = `rsync-nested-buck-out-${process.pid}`;
  const nestedBuckOut = path.join("build-tools", "tmp", marker, "buck-out");
  await fsp.mkdir(nestedBuckOut, { recursive: true });
  await fsp.writeFile(path.join(nestedBuckOut, "artifact"), "x");
  try {
    await withDefaultRsyncCopy(async () => {
      await runInTemp("rsync-excludes-nested-buck-out", async (tmp, $) => {
        const p = path.join(tmp, nestedBuckOut);
        if (await exists(p)) {
          console.error("expected nested buck-out to be excluded from temp copy:", p);
          process.exit(2);
        }
      });
    });
  } finally {
    await fsp.rm(path.join("build-tools", "tmp", marker), { recursive: true, force: true });
  }
});
