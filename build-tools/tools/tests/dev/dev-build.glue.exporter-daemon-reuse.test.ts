#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("dev-build glue config enables stable exporter daemon reuse", async () => {
  const glue = await fsp.readFile("viberoots/build-tools/tools/dev/dev-build/glue.ts", "utf8");
  if (!glue.includes("function stableExporterIsolation(root: string): string")) {
    throw new Error("glue.ts must define stableExporterIsolation helper");
  }
  if (!glue.includes('BUCK_EXPORTER_REUSE_DAEMON: "1"')) {
    throw new Error("glue.ts must enable BUCK_EXPORTER_REUSE_DAEMON for exporter runs");
  }
  if (!glue.includes("BUCK_NESTED_ISO: stableExporterIsolation(root)")) {
    throw new Error("glue.ts must use stable exporter isolation name");
  }
  if (!glue.includes("tools/dev/install-deps.ts") || !glue.includes("--glue-only")) {
    throw new Error("glue.ts must refresh generated glue through install-deps --glue-only");
  }
  if (!glue.includes("import { isVbrVerbose }")) {
    throw new Error("glue.ts must use shared verbose-mode detection");
  }
  if (!glue.includes('stdio: verbose ? "inherit" : "pipe"')) {
    throw new Error("glue.ts must pipe child output outside verbose/debug mode");
  }
  if (!glue.includes("buck2 -v 0 targets --console none //...")) {
    throw new Error("generated-target probes must suppress Buck daemon status output");
  }
  if (!glue.includes('BUCK_VERBOSE: "0"')) {
    throw new Error("glue/export probes must suppress Buck daemon status output by default");
  }
  if (glue.includes('BUCK_NO_ISOLATION: "1", EXPORTER_DEBUG: "1"')) {
    throw new Error("glue fallback warmup must not force exporter debug output");
  }
  if (glue.includes("runGomod2nixGenerate") || glue.includes("runGomod2nixScanAll")) {
    throw new Error("glue.ts must not duplicate gomod2nix work after install-deps --glue-only");
  }
  if (!glue.includes("runGluePipeline({ graphPath, skipProviderSync: true })")) {
    throw new Error("glue.ts must refresh graph-derived sidecars after exporting graph");
  }

  const runner = await fsp.readFile(
    "viberoots/build-tools/tools/buck/exporter/cquery/runner.ts",
    "utf8",
  );
  if (!runner.includes("process.env.BUCK_EXPORTER_REUSE_DAEMON")) {
    throw new Error("cquery runner must read BUCK_EXPORTER_REUSE_DAEMON");
  }
  if (!runner.includes('const reuse = reuseRaw ? reuseRaw === "1" : true;')) {
    throw new Error("cquery runner must default exporter daemon reuse to enabled");
  }
  if (!runner.includes("stableExporterIsolation(cwd)")) {
    throw new Error("cquery runner must derive stable shared exporter isolation per workspace");
  }
  if (!runner.includes("withSharedBuckIsolationStartupLock(cwd, iso")) {
    throw new Error("cquery runner must guard shared exporter daemon startup with a lock");
  }
  if (!runner.includes("if (reuse) return await fn();")) {
    throw new Error("cquery runner must skip daemon cleanup when reuse is enabled");
  }
  if (!runner.includes("const quietFlags =") || !runner.includes("buck2 ${quietFlags}")) {
    throw new Error("cquery runner must suppress Buck daemon status output by default");
  }

  const exporter = await fsp.readFile("viberoots/build-tools/tools/buck/exporter/main.ts", "utf8");
  if (
    !exporter.includes("process.env.VBR_VERBOSE") ||
    !exporter.includes("process.env.EXPORTER_DEBUG")
  ) {
    throw new Error("exporter success banner must be gated by verbose/debug mode");
  }

  const importerRoots = await fsp.readFile(
    "viberoots/build-tools/tools/dev/gen-importer-roots-bzl.ts",
    "utf8",
  );
  if (!importerRoots.includes("process.env.VBR_VERBOSE")) {
    throw new Error("importer roots generator must only log in verbose mode");
  }

  const exporterIo = await fsp.readFile("viberoots/build-tools/tools/buck/exporter/io.ts", "utf8");
  if (!exporterIo.includes("const quietFlags =") || !exporterIo.includes("buck2 ${quietFlags}")) {
    throw new Error("legacy exporter io cquery path must suppress Buck daemon status output");
  }

  const buck = await fsp.readFile("viberoots/build-tools/tools/dev/dev-build/buck.ts", "utf8");
  if (!buck.includes("quietEmptyGraphSubcommandFlags") || !buck.includes("DEVBUILD_EMPTY_GRAPH")) {
    throw new Error("empty-bootstrap final Buck build must suppress daemon status output");
  }
});
