#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { rsyncRepoTo, runInTemp } from "../lib/test-helpers";

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

async function assertMissing(p: string): Promise<void> {
  if (await exists(p)) {
    console.error("expected path to be excluded from temp copy:", p);
    process.exit(2);
  }
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

async function withEnv<T>(
  updates: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function makeSourceRoot(prefix: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.mkdir(path.join(root, "viberoots", "build-tools"), { recursive: true });
  await fsp.writeFile(path.join(root, "viberoots", "flake.nix"), "{}\n");
  await fsp.writeFile(path.join(root, "viberoots", ".live-edit-marker"), "transient\n");
  await fsp.writeFile(path.join(root, "viberoots", "build-tools", "keep.txt"), "keep\n");
  await fsp.mkdir(path.join(root, "viberoots", ".viberoots", "workspace", "buck"), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(root, "viberoots", ".viberoots", "workspace", "buck", "large-store-blob"),
    "generated\n",
  );
  return root;
}

async function makeViberootsSourceRoot(prefix: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.mkdir(path.join(root, "build-tools"), { recursive: true });
  await fsp.writeFile(path.join(root, "flake.nix"), "{}\n");
  await fsp.writeFile(path.join(root, "build-tools", "keep.txt"), "keep\n");
  await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck", "unified-pnpm-store"), {
    recursive: true,
  });
  await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n");
  await fsp.writeFile(path.join(root, ".source-fingerprint"), "transient\n");
  await fsp.writeFile(
    path.join(root, ".viberoots", "workspace", "buck", "unified-pnpm-store", "large-store-blob"),
    "generated\n",
  );
  return root;
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
    await assertMissing(path.join(dest, ".viberoots", "workspace", "buck"));
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
