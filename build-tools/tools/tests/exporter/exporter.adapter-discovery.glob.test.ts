#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("exporter discovers adapters by glob and ignores non-existent", async () => {
  await runInTemp("exporter-discovery", async (tmp, $) => {
    // Set up exporter lang dir with a toy adapter next to go.ts
    const langDir = path.join(tmp, "build-tools/tools/buck/exporter/lang");
    await fs.mkdirp(langDir);
    // Minimal exporter main/types to allow import without buck
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/buck/exporter/types.ts"),
      path.join(tmp, "build-tools/tools/buck/exporter/types.ts"),
    );
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/buck/exporter/lang/contract.ts"),
      path.join(tmp, "build-tools/tools/buck/exporter/lang/contract.ts"),
    );
    // Create a simple adapter file adapter.ts exporting { adapter }
    const toy = [
      "#!/usr/bin/env zx-wrapper",
      "import type { Adapter } from '../types';",
      "export const adapter: Adapter = {",
      "  name: 'toy',",
      "  isNode(n: any) { return Array.isArray(n.labels) && n.labels.includes('lang:toy'); },",
      "  async buildBatches(nodes: any[]) { return []; },",
      "  async attachLabels(nodes: any) { return nodes; }",
      "};",
      "",
    ].join("\n");
    await fs.outputFile(path.join(langDir, "adapter.ts"), toy);

    // Now import loadPresentAdapters from the temp tree
    const { loadPresentAdapters } = await import(
      path.join(tmp, "build-tools/tools/buck/exporter/lang/contract.ts")
    );
    const adapters = await loadPresentAdapters();
    const names = adapters.map((a: any) => a.name).sort();
    assert.ok(names.includes("toy"), "should include toy adapter by glob");
  });
});
