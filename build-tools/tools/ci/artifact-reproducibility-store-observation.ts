import type {
  ArtifactStoreDelta,
  ArtifactStorePathRole,
} from "../lib/artifact-reproducibility-observation";

export type RunNixForObservation = (args: string[]) => Promise<{ stdout: string }>;
export type StoreInventory = Map<string, number>;

export async function readStoreInventory(runNix: RunNixForObservation): Promise<StoreInventory> {
  const value = JSON.parse((await runNix(["path-info", "--all", "--json"])).stdout) as unknown;
  const inventory = new Map<string, number>();
  for (const [storePath, raw] of storeEntries(value)) {
    const narSize = Number((raw as { narSize?: unknown }).narSize);
    if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(storePath) || !Number.isSafeInteger(narSize)) {
      throw new Error("Nix store inventory contains an invalid path or narSize");
    }
    inventory.set(storePath, narSize);
  }
  return inventory;
}

export function storeInventoryJson(inventory: StoreInventory): Array<{
  path: string;
  narSize: number;
}> {
  return [...inventory]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, narSize]) => ({ path, narSize }));
}

export function storeInventoryFromJson(value: unknown): StoreInventory {
  if (!Array.isArray(value)) throw new Error("local store baseline is not an array");
  const inventory = new Map<string, number>();
  for (const entry of value) {
    const path = String((entry as { path?: unknown }).path || "");
    const narSize = Number((entry as { narSize?: unknown }).narSize);
    if (
      !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(path) ||
      !Number.isSafeInteger(narSize) ||
      inventory.has(path)
    ) {
      throw new Error("local store baseline contains an invalid entry");
    }
    inventory.set(path, narSize);
  }
  return inventory;
}

export function storeDelta(
  before: StoreInventory,
  after: StoreInventory,
  classify: (storePath: string) => ArtifactStorePathRole,
): ArtifactStoreDelta {
  const newPaths = [...after]
    .filter(([storePath]) => !before.has(storePath))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, narSize]) => ({ path, narSize, role: classify(path) }));
  return {
    beforeCount: before.size,
    afterCount: after.size,
    newNarSize: newPaths.reduce((total, entry) => total + entry.narSize, 0),
    newPaths,
  };
}

export async function readOutputAuthority(
  runNix: RunNixForObservation,
  outputPath: string,
  derivationPath: string,
): Promise<{ closure: Set<string>; derivations: Set<string> }> {
  const value = JSON.parse(
    (await runNix(["path-info", "--recursive", "--json", outputPath, derivationPath])).stdout,
  ) as unknown;
  const closure = new Set<string>();
  const derivations = new Set<string>();
  for (const [storePath, raw] of storeEntries(value)) {
    if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(storePath)) {
      throw new Error("artifact output closure contains an invalid store path");
    }
    closure.add(storePath);
    const deriver = String((raw as { deriver?: unknown }).deriver || "");
    if (deriver) {
      if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/u.test(deriver)) {
        throw new Error("artifact output closure contains an invalid derivation authority");
      }
      derivations.add(deriver);
    }
  }
  return { closure, derivations };
}

export function classifyOwnedStorePath(
  storePath: string,
  evaluationBundleRoots: readonly string[],
  outputPath: string,
  authority: { closure: Set<string>; derivations: Set<string> },
): ArtifactStorePathRole {
  if (evaluationBundleRoots.includes(storePath)) return "evaluation-bundle";
  if (storePath === outputPath) return "artifact-output";
  if (authority.derivations.has(storePath)) return "derivation";
  if (authority.closure.has(storePath) && storePath.endsWith(".drv")) return "derivation";
  if (authority.closure.has(storePath)) return "dependency-closure";
  throw new Error(`Nix store delta is not owned by this artifact cell: ${storePath}`);
}

function storeEntries(value: unknown): [string, unknown][] {
  return Array.isArray(value)
    ? value.map((entry) => [String((entry as { path?: unknown }).path || ""), entry])
    : Object.entries(value as Record<string, unknown>);
}
