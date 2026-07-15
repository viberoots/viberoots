import { runGoModTidyForMissingSum } from "./install/go-tidy";
import { runGomod2nixGenerateIn } from "./install/gomod2nix";
import { assertCppTrackedMetadataReady } from "./install/metadata-mode";
import { runUvRefreshAll } from "./install/uv";
import {
  projectLanguageSurfaces,
  projectModuleDirs,
  type ProjectLanguageId,
} from "./update-command/surfaces";

export type ReadOnlyLanguageChecks = Record<ProjectLanguageId, (root: string) => Promise<void>>;

async function withWorkspaceRoot(root: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env.WORKSPACE_ROOT;
  process.env.WORKSPACE_ROOT = root;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = previous;
  }
}

export const defaultReadOnlyLanguageChecks: ReadOnlyLanguageChecks = {
  go: async (root) =>
    await withWorkspaceRoot(root, async () => {
      await runGoModTidyForMissingSum(root, false, false, true);
      for (const dir of await projectModuleDirs(root, "go.mod")) {
        await runGomod2nixGenerateIn(dir, false, false, true);
      }
    }),
  python: async (root) =>
    await withWorkspaceRoot(root, async () => await runUvRefreshAll(false, false, true)),
  cpp: async (root) => await assertCppTrackedMetadataReady(root, true),
};

export async function runReadOnlyLanguageConsistencyChecks(
  root: string,
  checks: ReadOnlyLanguageChecks = defaultReadOnlyLanguageChecks,
): Promise<void> {
  for (const surface of projectLanguageSurfaces) {
    if (await surface.enabled(root)) await checks[surface.id](root);
  }
}
