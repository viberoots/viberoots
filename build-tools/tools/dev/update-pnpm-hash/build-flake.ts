import { withHeartbeat } from "./heartbeat";
import { makeFilteredFlakeRef } from "./filtered-flake";

export async function withPnpmStoreBuildFlakeRef<T>(
  opts: { repoRoot: string; importer: string; baseFlakeRef: string },
  fn: (buildFlakeRef: string) => Promise<T>,
): Promise<T> {
  if (opts.importer === ".") {
    return await fn(opts.baseFlakeRef);
  }

  const filtered = await withHeartbeat(
    `importer=${opts.importer} step=prepare-filtered-flake`,
    makeFilteredFlakeRef({ repoRoot: opts.repoRoot, attr: "pnpm" }),
  );
  try {
    if (!filtered.flakeRef.endsWith("#pnpm")) {
      throw new Error(
        `filtered pnpm flake ref must end with #pnpm for ${opts.importer}: ${filtered.flakeRef}`,
      );
    }
    return await fn(filtered.flakeRef.slice(0, -"#pnpm".length));
  } finally {
    await filtered.cleanup();
  }
}
