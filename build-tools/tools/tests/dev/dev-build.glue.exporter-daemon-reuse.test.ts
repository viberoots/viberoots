#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("dev-build glue config enables stable exporter daemon reuse", async () => {
  const glue = await fsp.readFile("build-tools/tools/dev/dev-build/glue.ts", "utf8");
  if (!glue.includes("function stableExporterIsolation(root: string): string")) {
    throw new Error("glue.ts must define stableExporterIsolation helper");
  }
  if (!glue.includes('BUCK_EXPORTER_REUSE_DAEMON: "1"')) {
    throw new Error("glue.ts must enable BUCK_EXPORTER_REUSE_DAEMON for exporter runs");
  }
  if (!glue.includes("BUCK_NESTED_ISO: stableExporterIsolation(root)")) {
    throw new Error("glue.ts must use stable exporter isolation name");
  }

  const runner = await fsp.readFile("build-tools/tools/buck/exporter/cquery/runner.ts", "utf8");
  if (!runner.includes("process.env.BUCK_EXPORTER_REUSE_DAEMON")) {
    throw new Error("cquery runner must read BUCK_EXPORTER_REUSE_DAEMON");
  }
  if (!runner.includes("if (reuse) return await fn();")) {
    throw new Error("cquery runner must skip daemon cleanup when reuse is enabled");
  }
});
