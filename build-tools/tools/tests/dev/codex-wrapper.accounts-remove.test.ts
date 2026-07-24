#!/usr/bin/env zx-wrapper
// Tests for `codex --remove-account`.
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { binWrapper, makeFakeAgentTools, scratchRoot } from "./agent-wrapper-test-helpers.ts";
import { sanitizedAccountWrapperEnv } from "./codex-wrapper.accounts-test-fixture.ts";

const wrapper = binWrapper("codex");

async function fixture(): Promise<{
  tmp: string;
  home: string;
  gitRoot: string;
  fake: { bin: string; log: string };
  env: NodeJS.ProcessEnv;
}> {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-remove-"));
  const gitRoot = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await fsp.mkdir(gitRoot, { recursive: true });
  const acctRoot = path.join(home, ".codex-accounts");
  for (const name of ["codex-account-a", "codex-account-b", "codex-account-c"]) {
    const p = path.join(acctRoot, name);
    await fsp.mkdir(p, { recursive: true });
    await fsp.writeFile(
      path.join(p, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test-only" }),
    );
  }
  await fsp.symlink("codex-account-a", path.join(acctRoot, "default"));
  await fsp.mkdir(path.join(acctRoot, "codex-account-b", ".login.lock"));
  const fake = await makeFakeAgentTools(tmp, gitRoot, "codex");
  const env = sanitizedAccountWrapperEnv({
    HOME: home,
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
    PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
    VBR_CODEX_SAFEHOUSE: "0",
    VBR_CODEX_NONINTERACTIVE: "1",
  });
  return { tmp, home, gitRoot, fake, env };
}

test("refuses to remove the default account (exit 78)", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --remove-account codex-account-a --yes`;
    assert.equal(res.exitCode, 78);
    assert.match(String(res.stderr), /default account/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("refuses when .login.lock/ is present (exit 78)", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --remove-account codex-account-b --yes`;
    assert.equal(res.exitCode, 78);
    assert.match(String(res.stderr), /login is in progress/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("refuses unknown account (exit 78)", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --remove-account codex-account-z --yes`;
    assert.equal(res.exitCode, 78);
    assert.match(String(res.stderr), /does not exist/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("non-interactive without --yes fails closed (exit 2)", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --remove-account codex-account-c`;
    assert.equal(res.exitCode, 2);
    assert.match(String(res.stderr), /requires --yes/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("succeeds with --yes; directory is removed and no other subcommand runs", async () => {
  const { tmp, home, gitRoot, fake, env } = await fixture();
  try {
    const target = path.join(home, ".codex-accounts", "codex-account-c");
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --remove-account codex-account-c --yes exec should-not-run`;
    assert.equal(res.exitCode, 0);
    await assert.rejects(fsp.stat(target));
    const log = await fsp.readFile(fake.log, "utf8").catch(() => "");
    assert.doesNotMatch(log, /should-not-run/);
    assert.match(String(res.stderr), /removed account 'codex-account-c'/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("CODEX_ACCOUNT_REMOVE_YES=1 substitutes for --yes", async () => {
  const { tmp, home, gitRoot, env } = await fixture();
  try {
    const target = path.join(home, ".codex-accounts", "codex-account-c");
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: { ...env, CODEX_ACCOUNT_REMOVE_YES: "1" },
      nothrow: true,
    })`${wrapper} --remove-account codex-account-c`;
    assert.equal(res.exitCode, 0);
    await assert.rejects(fsp.stat(target));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
