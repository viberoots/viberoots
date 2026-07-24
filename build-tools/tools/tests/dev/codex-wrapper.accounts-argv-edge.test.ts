#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

import {
  accountWrapper,
  accountWrapperFixture,
  cleanupAccountFixture,
  createApiKeyAccount,
} from "./codex-wrapper.accounts-test-fixture.ts";

test("duplicate removal selectors fail closed", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: fixture.env,
      nothrow: true,
    })`${accountWrapper} --remove-account codex-account-a --remove-account=codex-account-b --yes`;
    assert.equal(result.exitCode, 2);
    assert.match(String(result.stderr), /--remove-account specified more than once/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("wrapper-only tokens after a positional or -- are forwarded verbatim", async () => {
  for (const args of [
    ["exec", "--account", "codex-account-literal"],
    ["exec", "--", "--remove-account", "codex-account-literal"],
  ]) {
    const fixture = await accountWrapperFixture();
    try {
      await createApiKeyAccount(fixture.home, "codex-account-a");
      await fsp.symlink("codex-account-a", `${fixture.home}/.codex-accounts/default`);
      const result = await $({
        cwd: fixture.gitRoot,
        stdio: "pipe",
        env: fixture.env,
        nothrow: true,
      })`${accountWrapper} ${args}`;
      assert.equal(result.exitCode, 0, String(result.stderr));
      const log = await fsp.readFile(fixture.log, "utf8");
      assert.match(log, /--account codex-account-literal|--remove-account codex-account-literal/);
    } finally {
      await cleanupAccountFixture(fixture);
    }
  }
});

test("an explicitly empty two-token CLI selector fails closed", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: fixture.env,
      nothrow: true,
    })`${accountWrapper} --account ${""} exec empty`;
    assert.equal(result.exitCode, 2);
    assert.match(String(result.stderr), /--account requires a name/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("upstream option values, unknown-option tails, and unrelated --yes remain verbatim", async () => {
  for (const args of [
    ["-c", "--account=upstream-value", "exec", "config-value"],
    ["--future-upstream-flag", "--account=upstream-tail", "exec", "future"],
    ["--yes", "exec", "upstream-yes"],
  ]) {
    const fixture = await accountWrapperFixture();
    try {
      await createApiKeyAccount(fixture.home, "codex-account-a");
      await fsp.symlink("codex-account-a", `${fixture.home}/.codex-accounts/default`);
      const result = await $({
        cwd: fixture.gitRoot,
        stdio: "pipe",
        env: fixture.env,
        nothrow: true,
      })`${accountWrapper} ${args}`;
      assert.equal(result.exitCode, 0, String(result.stderr));
      const log = await fsp.readFile(fixture.log, "utf8");
      assert.match(log, new RegExp(`codex --sandbox danger-full-access ${args.join(" ")}`));
    } finally {
      await cleanupAccountFixture(fixture);
    }
  }
});
