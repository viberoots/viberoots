import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const generatedWorkspaceRoots = [
  "backups",
  "buck",
  "cache",
  "codex-test-logs",
  "install-cache",
  "nix-xdg-cache",
  "node",
  "node-modules-hidden",
  "pr-logs",
  "viberoots-flake-input",
  "xdg-cache",
];

export const generatedViberootsRoots = [
  ".codex-logs",
  ".viberoots",
  "backups",
  "cache",
  "codex-test-logs",
  "install-cache",
  "node_modules",
  "nix-xdg-cache",
  "pr-logs",
  "test-logs",
  "xdg-cache",
];

export async function withDefaultRsyncCopy(fn: () => Promise<void>): Promise<void> {
  const prevGoOnly = process.env.TEST_PARTIAL_CLONE_GO_ONLY;
  process.env.TEST_PARTIAL_CLONE_GO_ONLY = "1";
  try {
    await fn();
  } finally {
    if (prevGoOnly === undefined) delete process.env.TEST_PARTIAL_CLONE_GO_ONLY;
    else process.env.TEST_PARTIAL_CLONE_GO_ONLY = prevGoOnly;
  }
}

export async function exists(p: string): Promise<boolean> {
  return await fsp
    .access(p)
    .then(() => true)
    .catch(() => false);
}

export async function assertMissing(p: string): Promise<void> {
  if (await exists(p)) {
    console.error("expected path to be excluded from temp copy:", p);
    process.exit(2);
  }
}

export async function withRsyncOverlayRoot(
  fn: (overlayRoot: string) => Promise<void>,
): Promise<void> {
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

export async function withEnv<T>(
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

export async function makeSourceRoot(prefix: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.mkdir(path.join(root, "viberoots", "build-tools"), { recursive: true });
  await fsp.writeFile(path.join(root, "viberoots", "flake.nix"), "{}\n");
  await fsp.writeFile(path.join(root, "viberoots", ".live-edit-marker"), "transient\n");
  await fsp.writeFile(path.join(root, "viberoots", ".codex-focused-verify.log"), "generated\n");
  await fsp.writeFile(path.join(root, "viberoots", ".full-test-output.log"), "generated\n");
  await fsp.writeFile(path.join(root, "viberoots", ".patch-sessions.json"), "generated\n");
  await fsp.writeFile(path.join(root, "viberoots", "build-tools", "keep.txt"), "keep\n");
  await fsp.mkdir(path.join(root, "viberoots", ".viberoots", "workspace", "buck"), {
    recursive: true,
  });
  for (const generatedRoot of generatedWorkspaceRoots) {
    await fsp.mkdir(path.join(root, "viberoots", ".viberoots", "workspace", generatedRoot), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(root, "viberoots", ".viberoots", "workspace", generatedRoot, "large-store-blob"),
      "generated\n",
    );
  }
  for (const generatedRoot of generatedViberootsRoots) {
    await fsp.mkdir(path.join(root, "viberoots", generatedRoot), { recursive: true });
    await fsp.writeFile(
      path.join(root, "viberoots", generatedRoot, "large-store-blob"),
      "generated\n",
    );
  }
  return root;
}

export async function makeViberootsSourceRoot(prefix: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.mkdir(path.join(root, "build-tools"), { recursive: true });
  await fsp.writeFile(path.join(root, "flake.nix"), "{}\n");
  await fsp.writeFile(path.join(root, "build-tools", "keep.txt"), "keep\n");
  await fsp.writeFile(path.join(root, ".codex-focused-verify.log"), "generated\n");
  await fsp.writeFile(path.join(root, ".full-test-output.log"), "generated\n");
  await fsp.writeFile(path.join(root, ".patch-sessions.json"), "generated\n");
  await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck", "unified-pnpm-store"), {
    recursive: true,
  });
  await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n");
  await fsp.writeFile(path.join(root, ".source-fingerprint"), "transient\n");
  for (const generatedRoot of generatedWorkspaceRoots) {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", generatedRoot), { recursive: true });
    await fsp.writeFile(
      path.join(root, ".viberoots", "workspace", generatedRoot, "large-store-blob"),
      "generated\n",
    );
  }
  return root;
}
