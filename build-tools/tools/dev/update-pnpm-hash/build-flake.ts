import { withHeartbeat } from "./heartbeat";
import { makeFilteredFlakeRef } from "./filtered-flake";
import { evaluatePnpmStoreDerivationIdentity } from "./realized-store";

export async function withPnpmStoreBuildFlakeRef<T>(
  opts: { repoRoot: string; importer: string; baseFlakeRef: string },
  fn: (buildFlakeRef: string, filteredEnv?: Record<string, string>) => Promise<T>,
): Promise<T> {
  const filtered = await withHeartbeat(
    `importer=${opts.importer} step=prepare-filtered-flake`,
    makeFilteredFlakeRef({ repoRoot: opts.repoRoot, attr: "pnpm", importer: opts.importer }),
  );
  try {
    if (!filtered.flakeRef.endsWith("#pnpm")) {
      throw new Error(
        `filtered pnpm flake ref must end with #pnpm for ${opts.importer}: ${filtered.flakeRef}`,
      );
    }
    return await fn(filtered.flakeRef.slice(0, -"#pnpm".length), {
      WORKSPACE_ROOT: filtered.workspaceRoot,
      VBR_PNPM_FILTERED_SNAPSHOT_ROOT: filtered.workspaceRoot,
      ...(filtered.viberootsInputRoot
        ? { VIBEROOTS_FLAKE_INPUT_ROOT: filtered.viberootsInputRoot }
        : {}),
    });
  } finally {
    await filtered.cleanup();
  }
}

export async function currentPnpmStoreDerivationIdentity(opts: {
  repoRoot: string;
  importer: string;
  baseFlakeRef: string;
  attrPath: string;
}): Promise<string> {
  return await withPnpmStoreBuildFlakeRef(
    opts,
    async (buildFlakeRef, filteredEnv) =>
      await evaluatePnpmStoreDerivationIdentity({
        repoRoot: opts.repoRoot,
        flakeRef: buildFlakeRef,
        attrPath: opts.attrPath,
        env: { ...process.env, ...filteredEnv },
      }),
  );
}
