import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const VALID_NAR_HASH = `sha256-${"A".repeat(43)}=`;

export async function withWorkspace(
  prefix: string,
  fn: (workspace: string, lockFile: string) => Promise<void>,
): Promise<void> {
  const workspace = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  const prevViberootsFlakeInputRoot = process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
  const prevViberootsSourceRoot = process.env.VIBEROOTS_SOURCE_ROOT;
  const prevViberootsRoot = process.env.VIBEROOTS_ROOT;
  delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
  delete process.env.VIBEROOTS_SOURCE_ROOT;
  delete process.env.VIBEROOTS_ROOT;
  try {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const source = path.join(workspace, "viberoots");
    await fsp.mkdir(path.join(source, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join(source, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(path.join(source, "build-tools", "tools", "dev", "zx-init.mjs"), "\n");
    await fsp.mkdir(generated, { recursive: true });
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${source}"; outputs = _: {}; }\n`,
      "utf8",
    );
    const lockFile = path.join(generated, "flake.lock");
    await fn(workspace, lockFile);
  } finally {
    if (prevViberootsFlakeInputRoot === undefined) delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
    else process.env.VIBEROOTS_FLAKE_INPUT_ROOT = prevViberootsFlakeInputRoot;
    if (prevViberootsSourceRoot === undefined) delete process.env.VIBEROOTS_SOURCE_ROOT;
    else process.env.VIBEROOTS_SOURCE_ROOT = prevViberootsSourceRoot;
    if (prevViberootsRoot === undefined) delete process.env.VIBEROOTS_ROOT;
    else process.env.VIBEROOTS_ROOT = prevViberootsRoot;
    await fsp.rm(workspace, { recursive: true, force: true });
  }
}

export function lock(
  workspace: string,
  viberootsHash: string,
  nixpkgsHash = "sha256-nixpkgs",
): any {
  const source = path.join(workspace, "viberoots");
  return {
    nodes: {
      root: { inputs: { nixpkgs: "nixpkgs", viberoots: "viberoots" } },
      nixpkgs: { locked: { type: "github", narHash: nixpkgsHash } },
      viberoots: {
        locked: { type: "path", path: source, narHash: viberootsHash, lastModified: 1 },
        original: { type: "path", path: source },
      },
    },
    root: "root",
    version: 7,
  };
}

export async function writeLock(file: string, value: unknown): Promise<void> {
  await fsp.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function execReturning(candidate: unknown): any {
  return async () => ({
    stdout: JSON.stringify({ locks: candidate }),
    stderr: "",
  });
}
