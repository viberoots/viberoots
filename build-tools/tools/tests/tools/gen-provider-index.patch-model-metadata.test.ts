#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../../lib/providers.ts";
import { runInTemp } from "../lib/test-helpers";

test("gen-provider-index: provider_index.json includes patch model metadata (additive)", async () => {
  await runInTemp("gen-provider-index-patch-model", async (tmp, $) => {
    // Enable importer-scoped languages in the temp repo
    const nodeImporterDir = path.join(tmp, "apps", "web");
    const pyImporterDir = path.join(tmp, "apps", "pytool");
    await fsp.mkdir(nodeImporterDir, { recursive: true });
    await fsp.mkdir(pyImporterDir, { recursive: true });
    await fsp.writeFile(
      path.join(nodeImporterDir, "pnpm-lock.yaml"),
      `lockfileVersion: "9.0"\nimporters:\n  apps/web:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await fsp.writeFile(path.join(pyImporterDir, "uv.lock"), "", "utf8");

    await $`node build-tools/tools/buck/gen-provider-index.ts --out third_party/providers/provider_index.bzl`;

    const jsonPath = path.join(tmp, "third_party", "providers", "provider_index.json");
    const idx = JSON.parse(await fsp.readFile(jsonPath, "utf8")) as Record<string, any>;

    const nodeProvider = providerNameForImporter("apps/web/pnpm-lock.yaml", "apps/web");
    const nodeFq = `//third_party/providers:${nodeProvider}`;
    const nodeEntry = idx[nodeFq];
    if (!nodeEntry) {
      throw new Error(`expected Node provider entry in provider_index.json: ${nodeFq}`);
    }
    if (nodeEntry.kind !== "node") throw new Error("node entry: kind mismatch");
    if (nodeEntry.patch_scope !== "importer-local")
      throw new Error("node entry: patch_scope mismatch");
    if (!Array.isArray(nodeEntry.languages) || !nodeEntry.languages.includes("node")) {
      throw new Error("node entry: languages missing 'node'");
    }
    if (!nodeEntry.patch_inputs_expected_in?.macroActionInputs) {
      throw new Error("node entry: expected macroActionInputs=true");
    }
    if (nodeEntry.patch_inputs_expected_in?.providerPatchPaths !== "diagnostic") {
      throw new Error("node entry: expected providerPatchPaths='diagnostic'");
    }

    const pyProvider = providerNameForImporter("apps/pytool/uv.lock", "apps/pytool");
    const pyFq = `//third_party/providers:${pyProvider}`;
    const pyEntry = idx[pyFq];
    if (!pyEntry) {
      throw new Error(`expected Python provider entry in provider_index.json: ${pyFq}`);
    }
    if (pyEntry.kind !== "python") throw new Error("python entry: kind mismatch");
    if (pyEntry.patch_scope !== "importer-local")
      throw new Error("python entry: patch_scope mismatch");
    if (!Array.isArray(pyEntry.languages) || !pyEntry.languages.includes("python")) {
      throw new Error("python entry: languages missing 'python'");
    }

    // Go and C++ are package-local patching languages; they share nixpkgs-backed providers.
    // Assert at least one provider index entry carries both language ids and package-local scope.
    const cppLike = Object.values(idx).find(
      (e: any) =>
        e &&
        e.kind === "cpp" &&
        e.patch_scope === "package-local" &&
        Array.isArray(e.languages) &&
        e.languages.includes("go") &&
        e.languages.includes("cpp"),
    );
    if (!cppLike) {
      throw new Error(
        "expected at least one cpp-kind entry with languages ['go','cpp'] and patch_scope 'package-local'",
      );
    }

    // Mapping file is required by CI-mode prebuild checks; ensure it is present after generation.
    const nixMap = path.join(tmp, "third_party", "providers", "nix_attr_map.bzl");
    const nixMapTxt = await fsp.readFile(nixMap, "utf8").catch(() => "");
    if (!nixMapTxt.includes("NIX_ATTR_MAP")) {
      throw new Error("expected nix_attr_map.bzl to be generated and include NIX_ATTR_MAP");
    }
  });
});
