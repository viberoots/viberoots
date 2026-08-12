#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  inheritedBuckIsolation,
  nestedBuckTestArgs,
  reconcileTempDependencyInputs,
  runInTemp,
} from "../lib/test-helpers";

type Fixture = { name: string; body: string; procMacro?: boolean };

async function writePackage(root: string, fixture: Fixture): Promise<void> {
  const dir = path.join(root, "projects", "apps", fixture.name);
  await fs.mkdirp(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src", "lib.rs"), fixture.body);
  if (fixture.procMacro) {
    await fs.mkdirp(path.join(dir, "proc-helper", "src"));
    await fs.writeFile(
      path.join(dir, "proc-helper", "Cargo.toml"),
      '[package]\nname="proc-helper"\nversion="0.1.0"\nedition="2021"\n\n[lib]\nproc-macro=true\n',
    );
    await fs.writeFile(
      path.join(dir, "proc-helper", "src", "lib.rs"),
      [
        "use proc_macro::TokenStream;",
        "",
        "#[proc_macro_attribute]",
        "pub fn identity(_: TokenStream, item: TokenStream) -> TokenStream {",
        "    item",
        "}",
        "",
      ].join("\n"),
    );
  }
  await fs.writeFile(
    path.join(dir, "Cargo.toml"),
    `[package]\nname="${fixture.name}"\nversion="0.1.0"\nedition="2021"\n${fixture.procMacro ? '\n[dependencies]\nproc-helper={path="proc-helper"}\n' : ""}`,
  );
  await fs.writeFile(
    path.join(dir, "Cargo.lock"),
    fixture.procMacro
      ? `version = 3\n\n[[package]]\nname = "proc-helper"\nversion = "0.1.0"\n\n[[package]]\nname = "${fixture.name}"\nversion = "0.1.0"\ndependencies = [\n "proc-helper",\n]\n`
      : `version = 3\n\n[[package]]\nname = "${fixture.name}"\nversion = "0.1.0"\n`,
  );
  await fs.writeFile(
    path.join(dir, "TARGETS"),
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_test")',
      `rust_test(name = "test", crate = "${fixture.name}", srcs = ["src/lib.rs"])`,
      "",
    ].join("\n"),
  );
}

test("rust_test executes Cargo harnesses through Buck's external runner", async () => {
  await runInTemp("rust-native-test-runner", async (tmp, $) => {
    for (const fixture of [
      {
        name: "passing",
        body: [
          "use proc_helper::identity;",
          "",
          "#[identity]",
          "#[test]",
          "fn passes() {",
          "    assert_eq!(2 + 2, 4);",
          "}",
          "",
        ].join("\n"),
        procMacro: true,
      },
      {
        name: "failing",
        body: "#[test]\nfn fails() {\n    assert_eq!(1, 2);\n}\n",
      },
      {
        name: "filtered",
        body: [
          "#[test]",
          "fn selected_passes() {",
          "    assert_eq!(3, 3);",
          "}",
          "",
          "#[test]",
          "fn excluded_fails() {",
          '    panic!("filter was discarded");',
          "}",
          "",
        ].join("\n"),
      },
      {
        name: "ignored",
        body: '#[test]\n#[ignore]\nfn skipped() {\n    panic!("must stay ignored");\n}\n',
      },
      { name: "empty", body: "pub fn value() -> u8 {\n    1\n}\n" },
    ]) {
      await writePackage(tmp, fixture);
    }
    await reconcileTempDependencyInputs(tmp, $);
    const standaloneBuckEnv = {
      ...process.env,
      BUCK_ISOLATION_DIR: "",
      BUCK_NESTED_ISO: "",
      BUCK_TEST_SRC: tmp,
      WORKSPACE_ROOT: tmp,
    };

    const pass = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
      buck2 --isolation-dir ${inheritedBuckIsolation("rust-native-test-runner-pass", standaloneBuckEnv)} test --target-platforms prelude//platforms:default //projects/apps/passing:test //projects/apps/ignored:test //projects/apps/empty:test -- ${nestedBuckTestArgs}
    `;
    assert.equal(pass.exitCode, 0, String(pass.stderr || pass.stdout));

    const filtered = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
      buck2 --isolation-dir ${inheritedBuckIsolation("rust-native-test-runner-filtered", standaloneBuckEnv)} test --target-platforms prelude//platforms:default //projects/apps/filtered:test -- ${nestedBuckTestArgs} --test-arg selected_passes
    `;
    assert.equal(filtered.exitCode, 0, String(filtered.stderr || filtered.stdout));

    const failure = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
      buck2 --isolation-dir ${inheritedBuckIsolation("rust-native-test-runner-failure", standaloneBuckEnv)} test --target-platforms prelude//platforms:default //projects/apps/failing:test -- ${nestedBuckTestArgs}
    `;
    assert.notEqual(failure.exitCode, 0);
    assert.match(String(failure.stderr || failure.stdout), /fails|assertion.*failed/i);
  });
});
