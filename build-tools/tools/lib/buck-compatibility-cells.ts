import path from "node:path";
import { writeIfChanged } from "./fs-helpers";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";

const cellConfig = "[buildfile]\nname = TARGETS\n";

export async function ensureBuckCompatibilityCells(workspaceRoot: string): Promise<void> {
  for (const cell of ["fbsource", "fbcode"]) {
    const root = path.join(workspaceRoot, ".viberoots", "workspace", "buck-cell-stubs", cell);
    await mkdirWithMacosMetadataExclusion(root);
    await writeIfChanged(path.join(root, ".buckconfig"), cellConfig);
    await writeIfChanged(
      path.join(root, "TARGETS"),
      `# generated empty ${cell} compatibility cell\n`,
    );
  }
}
