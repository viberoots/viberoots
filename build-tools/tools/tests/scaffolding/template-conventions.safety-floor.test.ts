#!/usr/bin/env zx-wrapper
import { test } from "node:test";

const SAFETY_FLOOR_TARGETS = [
  "//:scaffolding_smoke_lib_readme",
  "//:scaffolding_smoke_cli_readme",
  "//:scaffolding_python_wasm_app_scaffold_smoke",
];

test("template safety-floor targets are resolvable", async () => {
  const query = `set(${SAFETY_FLOOR_TARGETS.join(" ")})`;
  const isolationDir = "template_conventions_safety_floor";
  const out = await $({
    stdio: "pipe",
    env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
  })`buck2 --isolation-dir ${isolationDir} cquery ${query} --json --output-attribute name`;
  const raw = JSON.parse(out.stdout) as Record<string, { name?: string }>;
  const resolved = Object.keys(raw).map((k) => k.replace(/\s+\([^)]*\)$/, ""));
  for (const target of SAFETY_FLOOR_TARGETS) {
    const absolute = `root${target}`;
    if (!resolved.includes(absolute)) {
      throw new Error(`safety-floor target did not resolve: ${target}`);
    }
  }
});
