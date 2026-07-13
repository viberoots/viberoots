import { withHeartbeat } from "./heartbeat";
import { makeFilteredFlakeRef } from "./filtered-flake";

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
    });
  } finally {
    await filtered.cleanup();
  }
}
