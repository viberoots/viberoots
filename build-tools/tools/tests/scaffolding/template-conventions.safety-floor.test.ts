#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import {
  buckCommandEnv,
  isBuckDaemonInitTransient,
  resolveNestedBuckIsolation,
} from "../../lib/buck-command-env.ts";

const SAFETY_FLOOR_TARGETS = [
  "//:scaffolding_smoke_lib_readme",
  "//:scaffolding_smoke_cli_readme",
  "//:scaffolding_python_wasm_app_scaffold_smoke",
];
const TARGET_PLATFORM = "prelude//platforms:default";

test("template safety-floor targets are resolvable", async () => {
  const query = `set(${SAFETY_FLOOR_TARGETS.join(" ")})`;
  const { isolationDir, ownsIsolation } = resolveNestedBuckIsolation({
    prefix: "template-conventions",
  });
  const env = { ...buckCommandEnv(), IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" };
  const withTransientRetry = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isBuckDaemonInitTransient(msg)) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      return await run();
    }
  };
  try {
    const out = await withTransientRetry(
      async () =>
        await $({
          stdio: "pipe",
          env,
        })`buck2 --isolation-dir ${isolationDir} cquery --target-platforms ${TARGET_PLATFORM} ${query} --json --output-attribute name`,
    );
    const raw = JSON.parse(out.stdout) as Record<string, { name?: string }>;
    const resolved = Object.keys(raw).map((k) => k.replace(/\s+\([^)]*\)$/, ""));
    for (const target of SAFETY_FLOOR_TARGETS) {
      const absolute = `root${target}`;
      if (!resolved.includes(absolute)) {
        throw new Error(`safety-floor target did not resolve: ${target}`);
      }
    }
  } finally {
    if (ownsIsolation) {
      await $({
        stdio: "ignore",
        reject: false,
        env,
      })`buck2 --isolation-dir ${isolationDir} kill`;
    }
  }
});
