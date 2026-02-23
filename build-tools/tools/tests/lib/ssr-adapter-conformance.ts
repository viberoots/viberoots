#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { exists } from "./test-helpers.ts";
import { inferRunnableFromOutPath } from "../../lib/runnables.ts";

type SsrAdapterConformanceOpts = {
  label: string;
  outPath: string;
  importer: string;
  framework: "express" | "next" | "vite";
};

export async function assertSsrAdapterConformance(opts: SsrAdapterConformanceOpts): Promise<void> {
  const serverEntry = path.join(opts.outPath, "dist", "server", "index.js");
  const clientDir = path.join(opts.outPath, "dist", "client");
  assert.equal(await exists(serverEntry), true, `missing serverEntry: ${serverEntry}`);
  assert.equal(await exists(clientDir), true, `missing clientDir: ${clientDir}`);

  const runnable = await inferRunnableFromOutPath({
    label: opts.label,
    outPath: opts.outPath,
    importer: opts.importer,
    mode: "ssr",
    framework: opts.framework,
  });
  assert.ok(runnable, "expected SSR runnable contract");
  assert.equal(runnable?.kind, "webapp-ssr");
  assert.equal(runnable?.framework, opts.framework);
  assert.deepEqual(runnable?.run.prod.argv, ["node", serverEntry]);
  assert.deepEqual(runnable?.run.dev?.argv, ["pnpm", "--dir", opts.importer, "dev:ssr"]);
  assert.equal(
    runnable?.run.prod.argv.some((arg) => arg.includes("build-tools") || arg.includes("planner")),
    false,
    "prod startup command must not depend on planner/build-tools at runtime",
  );
}
