import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runManagedCommand } from "../../lib/managed-command";
import { staleMetadataError } from "./metadata-mode";
import { withFileRollback } from "../update-command/file-transaction";
import { languageUpdateTimeoutMs } from "../update-command/languages";
import { projectModuleDirs } from "../update-command/surfaces";

type LockOutput = { destination: string; bytes?: Buffer };
type CargoSourcePolicy = { supported_lock_sources?: unknown };
const cargoSourcePolicyFile = fileURLToPath(
  new URL("../../../rust/cargo-source-policy.json", import.meta.url),
);
const ignoredCopyEntries = new Set([".git", ".viberoots", "buck-out", "node_modules", "target"]);
async function assertContainedSymlinks(root: string, dir = root): Promise<void> {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (ignoredCopyEntries.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await assertContainedSymlinks(root, file);
    if (!entry.isSymbolicLink()) continue;
    const target = await fsp.readlink(file);
    const resolved = path.resolve(path.dirname(file), target);
    if (
      path.isAbsolute(target) ||
      (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    ) {
      throw new Error(`Cargo temporary copy rejects external symlink: ${file} -> ${target}`);
    }
  }
}

async function cargoLocks(root: string): Promise<string[]> {
  const locks: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (ignoredCopyEntries.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name === "Cargo.lock") locks.push(file);
    }
  }
  await visit(root);
  return locks.sort();
}

async function assertSupportedCargoLockSources(lockFile: string): Promise<void> {
  const policy = JSON.parse(await fsp.readFile(cargoSourcePolicyFile, "utf8")) as CargoSourcePolicy;
  if (
    !Array.isArray(policy.supported_lock_sources) ||
    policy.supported_lock_sources.some((source) => typeof source !== "string")
  ) {
    throw new Error("Rust Cargo source policy must declare supported_lock_sources strings");
  }
  const supported = new Set(policy.supported_lock_sources as string[]);
  const content = await fsp.readFile(lockFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const quotedAssignment = /^\s*(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*=/.test(line);
    if (quotedAssignment && !/^\s*(?:"source"|'source')\s*=/.test(line)) {
      throw new Error(`Rust Cargo.lock contains unsupported quoted assignment key: ${line}`);
    }
    if (!/^\s*(?:source|"source"|'source')\s*=/.test(line)) continue;
    const assignment = line.match(
      /^\s*(?:source|"source"|'source')\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/,
    );
    if (!assignment) {
      throw new Error(`Rust Cargo.lock contains unsupported source assignment syntax: ${line}`);
    }
    const source = assignment[1] ?? assignment[2];
    if (!supported.has(source)) {
      throw new Error(`Rust Cargo.lock contains unsupported dependency source: ${source}`);
    }
  }
}

async function copyCargoRoot(
  source: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  await assertContainedSymlinks(source);
  const owner = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-metadata-"));
  const root = path.join(owner, path.basename(source));
  await fsp.cp(source, root, {
    recursive: true,
    filter: (candidate) =>
      candidate === source || !ignoredCopyEntries.has(path.basename(candidate)),
  });
  return { root, cleanup: async () => await fsp.rm(owner, { recursive: true, force: true }) };
}

export async function assertCargoConfigIsolation(
  cargoRoot: string,
  cargoHome: string,
): Promise<void> {
  const candidates = [path.join(cargoHome, "config"), path.join(cargoHome, "config.toml")];
  for (let current = path.resolve(cargoRoot); ; current = path.dirname(current)) {
    candidates.push(path.join(current, ".cargo/config"), path.join(current, ".cargo/config.toml"));
    if (path.dirname(current) === current) break;
  }
  for (const candidate of candidates) {
    const exists = await fsp.access(candidate).then(
      () => true,
      () => false,
    );
    if (exists) {
      throw new Error(
        `Rust Cargo configuration is unsupported because it can replace dependency sources: ${candidate}`,
      );
    }
  }
}

async function runCargo(
  cargoBin: string,
  args: string[],
  cwd: string,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const commandEnv = { ...env };
  for (const key of Object.keys(commandEnv)) {
    if (key.startsWith("CARGO_") || ["RUSTC", "RUSTFLAGS", "RUSTUP_HOME"].includes(key)) {
      delete commandEnv[key];
    }
  }
  const cargoHome = path.join(workspaceRoot, ".viberoots", "workspace", "cargo-home");
  await assertCargoConfigIsolation(cwd, cargoHome);
  await fsp.mkdir(cargoHome, { recursive: true });
  const result = await runManagedCommand({
    command: cargoBin,
    args,
    cwd,
    env: { ...commandEnv, CARGO_HOME: cargoHome, CARGO_NET_OFFLINE: "true" },
    timeoutMs: languageUpdateTimeoutMs(env),
  });
  if (result.ok && !result.interrupted) return;
  const reason = result.timedOut
    ? `timed out after ${languageUpdateTimeoutMs(env) / 1000}s`
    : result.interrupted
      ? "was interrupted"
      : `exited ${String(result.code)}`;
  throw new Error(`cargo ${args.join(" ")} ${reason} in ${cwd}\n${result.stderr}`.trim());
}

const metadataArgs = ["metadata", "--offline", "--format-version", "1"];
const lockedMetadataArgs = ["metadata", "--locked", "--offline", "--format-version", "1"];

function canonicalCargoBin(root: string): string {
  const toolsRoot = canonicalArtifactToolsRoot(root);
  return ensureNixStoreToolPathSync("cargo", { PATH: path.join(toolsRoot, "bin") });
}

export async function assertRustTrackedMetadataReady(
  root: string,
  cargoBin?: string,
): Promise<void> {
  const roots = await projectModuleDirs(root, "Cargo.toml");
  if (roots.length === 0) return;
  const resolvedCargo = cargoBin || canonicalCargoBin(root);
  for (const cargoRoot of roots) {
    const relativeLock = path.relative(root, path.join(cargoRoot, "Cargo.lock")) || "Cargo.lock";
    try {
      await fsp.access(path.join(cargoRoot, "Cargo.lock"));
      await assertSupportedCargoLockSources(path.join(cargoRoot, "Cargo.lock"));
      const copy = await copyCargoRoot(cargoRoot);
      try {
        await runCargo(resolvedCargo, lockedMetadataArgs, copy.root, root);
      } finally {
        await copy.cleanup();
      }
    } catch (error) {
      throw staleMetadataError(relativeLock.replace(/\\/g, "/"), String(error));
    }
  }
}

async function prepareCargoRoot(
  cargoRoot: string,
  upgrade: boolean,
  cargoBin: string,
  workspaceRoot: string,
): Promise<{ outputs: LockOutput[]; cleanup: () => Promise<void> }> {
  const before = await cargoLocks(cargoRoot);
  const copy = await copyCargoRoot(cargoRoot);
  try {
    if (upgrade) await runCargo(cargoBin, ["update", "--offline"], copy.root, workspaceRoot);
    else await runCargo(cargoBin, metadataArgs, copy.root, workspaceRoot);
    await runCargo(cargoBin, lockedMetadataArgs, copy.root, workspaceRoot);
    const after = await cargoLocks(copy.root);
    for (const lock of after) await assertSupportedCargoLockSources(lock);
    const relativeLocks = new Set([
      ...before.map((file) => path.relative(cargoRoot, file)),
      ...after.map((file) => path.relative(copy.root, file)),
    ]);
    const outputs = await Promise.all(
      [...relativeLocks].sort().map(async (relative): Promise<LockOutput> => {
        const generated = path.join(copy.root, relative);
        const bytes = await fsp.readFile(generated).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        return { destination: path.join(cargoRoot, relative), bytes };
      }),
    );
    return { outputs, cleanup: copy.cleanup };
  } catch (error) {
    await copy.cleanup();
    throw error;
  }
}

export async function repairRustDependencies(
  root: string,
  verbose: boolean,
  upgrade = false,
  cargoBin?: string,
): Promise<number> {
  const roots = await projectModuleDirs(root, "Cargo.toml");
  if (roots.length === 0) return 0;
  const resolvedCargo = cargoBin || canonicalCargoBin(root);
  const prepared: Array<{ outputs: LockOutput[]; cleanup: () => Promise<void> }> = [];
  try {
    for (const cargoRoot of roots) {
      if (verbose) {
        console.log(
          `[update] Rust: ${upgrade ? "upgrading" : "reconciling"} ${path.relative(root, cargoRoot) || "."}`,
        );
      }
      prepared.push(await prepareCargoRoot(cargoRoot, upgrade, resolvedCargo, root));
    }
    const outputs = prepared.flatMap((entry) => entry.outputs);
    await withFileRollback(
      outputs.map((entry) => entry.destination),
      async () => {
        for (const output of outputs) {
          if (output.bytes === undefined) await fsp.rm(output.destination, { force: true });
          else {
            await fsp.mkdir(path.dirname(output.destination), { recursive: true });
            await fsp.writeFile(output.destination, output.bytes);
          }
        }
      },
    );
    return roots.length;
  } finally {
    await Promise.all(prepared.map((entry) => entry.cleanup()));
  }
}
