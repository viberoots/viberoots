import * as fsp from "node:fs/promises";
import path from "node:path";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { timeAsyncDetail } from "../../lib/timing-detail";
import { staleMetadataError } from "./metadata-mode";
import { withFileRollback } from "../update-command/file-transaction";
import { projectModuleDirs } from "../update-command/surfaces";
import { assertCargoConfigIsolation, runCargo } from "./cargo-command";
import { cargoCommandHome, workspaceCargoHome } from "./cargo-home";
import { assertSupportedCargoLockSources } from "./cargo-source-policy";
import {
  fixedSourcesFromCargoMetadata,
  materializeFixedSources,
  mergeFixedSourceMaps,
  type FixedSourceEntry,
  type FixedSourceMap,
} from "./cargo-fixed-sources";
import { fixedSourceManifestMatches, fixedSourceManifestPath } from "./cargo-fixed-source-manifest";
import { cargoSourceMaterialization } from "./cargo-source-materializer";
import { cargoLocks, copyCargoRoot } from "./cargo-root-copy";

type LockOutput = { destination: string; bytes?: Buffer };

export { assertCargoConfigIsolation } from "./cargo-command";

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
  const fixedSourceMaps: FixedSourceMap[] = [];
  for (const cargoRoot of roots) {
    const relativeLock = path.relative(root, path.join(cargoRoot, "Cargo.lock")) || "Cargo.lock";
    try {
      await fsp.access(path.join(cargoRoot, "Cargo.lock"));
      await assertSupportedCargoLockSources(path.join(cargoRoot, "Cargo.lock"));
      const copy = await copyCargoRoot(cargoRoot, root);
      try {
        const metadataJSON = await runCargo(resolvedCargo, lockedMetadataArgs, copy.root, root);
        fixedSourceMaps.push(
          await fixedSourcesFromCargoMetadata(metadataJSON, path.join(copy.root, "Cargo.lock")),
        );
      } finally {
        await copy.cleanup();
      }
    } catch (error) {
      throw staleMetadataError(relativeLock.replace(/\\/g, "/"), String(error));
    }
  }
  const expected = mergeFixedSourceMaps(fixedSourceMaps);
  const manifest = fixedSourceManifestPath(root);
  if (!(await fixedSourceManifestMatches(root, expected))) {
    throw staleMetadataError(
      path.relative(root, manifest).replace(/\\/g, "/"),
      "Rust fixed-source metadata changed",
    );
  }
}

async function prepareCargoRoot(
  cargoRoot: string,
  upgrade: boolean,
  cargoBin: string,
  workspaceRoot: string,
): Promise<{
  outputs: LockOutput[];
  fixedSources: FixedSourceMap;
  cleanup: () => Promise<void>;
}> {
  const relativeRoot = path.relative(workspaceRoot, cargoRoot) || ".";
  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> =>
    await timeAsyncDetail(`Rust dependency repair ${relativeRoot} ${label}`, fn);
  const before = await timed("initial lock discovery", async () => await cargoLocks(cargoRoot));
  const copy = await timed(
    "temporary root copy",
    async () => await copyCargoRoot(cargoRoot, workspaceRoot),
  );
  try {
    const rootLock = path.join(cargoRoot, "Cargo.lock");
    if (
      !upgrade &&
      (await fsp.access(rootLock).then(
        () => true,
        () => false,
      ))
    ) {
      // Reconciliation may fetch only the already-locked graph into the
      // workspace-owned Cargo home. Upgrade must reach `cargo update --offline`
      // before requiring a current lock so stale path dependency metadata can be
      // repaired transactionally.
      await assertSupportedCargoLockSources(rootLock);
      await timed(
        "locked fetch",
        async () =>
          await runCargo(cargoBin, ["fetch", "--locked"], copy.root, workspaceRoot, false),
      );
    }
    if (upgrade) {
      await timed(
        "offline update",
        async () => await runCargo(cargoBin, ["update", "--offline"], copy.root, workspaceRoot),
      );
    } else {
      await timed(
        "offline metadata reconciliation",
        async () => await runCargo(cargoBin, metadataArgs, copy.root, workspaceRoot),
      );
    }
    const metadataJSON = await timed(
      "locked offline metadata",
      async () => await runCargo(cargoBin, lockedMetadataArgs, copy.root, workspaceRoot),
    );
    const after = await timed("generated lock discovery", async () => await cargoLocks(copy.root));
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
    const fixedSources = await timed(
      "fixed source extraction",
      async () =>
        await fixedSourcesFromCargoMetadata(metadataJSON, path.join(copy.root, "Cargo.lock")),
    );
    return { outputs, fixedSources, cleanup: copy.cleanup };
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
  materializeSource?: (
    key: string,
    entry: FixedSourceEntry,
  ) => Promise<{ storePath: string; narHash: string }>,
  runGitSource?: (command: string, args: string[], cwd: string) => Promise<string>,
): Promise<number> {
  const roots = await projectModuleDirs(root, "Cargo.toml");
  if (roots.length === 0) return 0;
  const resolvedCargo = cargoBin || canonicalCargoBin(root);
  const prepared: Array<{
    outputs: LockOutput[];
    fixedSources: FixedSourceMap;
    cleanup: () => Promise<void>;
  }> = [];
  try {
    for (const cargoRoot of roots) {
      if (verbose) {
        console.log(
          `[update] Rust: ${upgrade ? "upgrading" : "reconciling"} ${path.relative(root, cargoRoot) || "."}`,
        );
      }
      prepared.push(
        await timeAsyncDetail(
          `Rust dependency repair ${path.relative(root, cargoRoot) || "."} preparation total`,
          async () => await prepareCargoRoot(cargoRoot, upgrade, resolvedCargo, root),
        ),
      );
    }
    const mergedFixedSources = mergeFixedSourceMaps(prepared.map((entry) => entry.fixedSources));
    const materializedEntries = Object.values(mergedFixedSources).filter(
      (entry) => entry.source.startsWith("registry+") || entry.source.startsWith("git+"),
    );
    const needsGit = materializedEntries.some((entry) => entry.source.startsWith("git+"));
    const productionMaterialization =
      (!materializeSource && materializedEntries.length > 0) || (needsGit && !runGitSource)
        ? cargoSourceMaterialization(root)
        : undefined;
    const fixedSources = await timeAsyncDetail(
      "Rust dependency repair fixed source materialization",
      async () =>
        await materializeFixedSources(
          mergedFixedSources,
          materializeSource ||
            productionMaterialization?.materialize ||
            (async () => {
              throw new Error("Cargo fixed-source materialization authority is unavailable");
            }),
          runGitSource || productionMaterialization?.runGit,
          cargoCommandHome(root),
          productionMaterialization?.deferredMaterialization,
        ),
    );
    const fixedSourceManifest = fixedSourceManifestPath(root);
    const outputs = [
      ...prepared.flatMap((entry) => entry.outputs),
      {
        destination: fixedSourceManifest,
        bytes: Buffer.from(`${JSON.stringify(fixedSources, null, 2)}\n`),
      },
    ];
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
