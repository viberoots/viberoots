#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { buckCommandEnv, resolveNestedBuckIsolation } from "../../lib/buck-command-env";

const { isolationDir, ownsIsolation } = resolveNestedBuckIsolation({
  prefix: "project-enforcement-convention",
});
const fixture = "viberoots//build-tools/tools/tests/verify/project-enforcement-convention-fixtures";

test("project-enforcement convention rejects membership and pass conflicts at analysis", async () => {
  try {
    for (const [target, message] of [
      ["suffix_without_label", "project-enforcement test must include verify:project-enforcement"],
      [
        "label_without_suffix",
        "non-project-enforcement test must not include verify:project-enforcement",
      ],
    ] as const) {
      const result = await $({
        env: buckCommandEnv(),
        nothrow: true,
        quiet: true,
      })`buck2 --isolation-dir ${isolationDir} build --target-platforms prelude//platforms:default ${`${fixture}:${target}`}`;
      assert.notEqual(result.exitCode, 0, `expected ${target} analysis to fail`);
      assert.match(String(result.stderr), new RegExp(message));
    }
    for (const target of [
      "conflict_enforcement",
      "conflict_isolated",
      "conflict_isolated_bounded",
      "conflict_resource_limited",
      "conflict_manual",
    ]) {
      const result = await $({
        env: buckCommandEnv(),
        nothrow: true,
        quiet: true,
      })`buck2 --isolation-dir ${isolationDir} build --target-platforms prelude//platforms:default ${`${fixture}:${target}`}`;
      assert.notEqual(result.exitCode, 0, `expected ${target} analysis to fail`);
      assert.match(String(result.stderr), /project-enforcement test has conflicting labels/);
    }
    await $({
      env: buckCommandEnv(),
      quiet: true,
    })`buck2 --isolation-dir ${isolationDir} build --target-platforms prelude//platforms:default ${`${fixture}:valid_project_enforcement`}`;
  } finally {
    if (ownsIsolation) {
      await $({
        env: buckCommandEnv(),
        nothrow: true,
        quiet: true,
      })`buck2 --isolation-dir ${isolationDir} kill`;
    }
  }
});
