#!/usr/bin/env zx-wrapper
// Tests precedence resolution across --account, CODEX_HOME, CODEX_ACCOUNT,
// ~/.codex-accounts/default, and legacy ~/.codex/.
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { binWrapper, makeFakeAgentTools, scratchRoot } from "./agent-wrapper-test-helpers.ts";
import { sanitizedAccountWrapperEnv } from "./codex-wrapper.accounts-test-fixture.ts";

const wrapper = binWrapper("codex");

async function baseFixture(): Promise<{
  tmp: string;
  home: string;
  gitRoot: string;
  fake: { bin: string; log: string };
  baseEnv: NodeJS.ProcessEnv;
}> {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-prec-"));
  const gitRoot = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await fsp.mkdir(gitRoot, { recursive: true });
  const fake = await makeFakeAgentTools(tmp, gitRoot, "codex");
  const baseEnv = sanitizedAccountWrapperEnv({
    HOME: home,
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
    PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
    VBR_CODEX_SAFEHOUSE: "0",
    VBR_CODEX_NONINTERACTIVE: "1",
  });
  return { tmp, home, gitRoot, fake, baseEnv };
}

async function makeAccount(root: string, name: string): Promise<string> {
  const p = path.join(root, name);
  await fsp.mkdir(p, { recursive: true });
  await fsp.writeFile(
    path.join(p, "auth.json"),
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test-only" }),
    "utf8",
  );
  return p;
}

test("--account beats CODEX_HOME (and warns) beats CODEX_ACCOUNT beats default symlink beats legacy", async () => {
  const { tmp, home, gitRoot, fake, baseEnv } = await baseFixture();
  try {
    const acctRoot = path.join(home, ".codex-accounts");
    await makeAccount(acctRoot, "codex-account-a");
    await makeAccount(acctRoot, "codex-account-b");
    await makeAccount(acctRoot, "codex-account-c");
    await fsp.symlink("codex-account-c", path.join(acctRoot, "default"));
    await fsp.mkdir(path.join(home, ".codex"), { recursive: true }); // legacy

    // Case 1: --account wins even when CODEX_HOME set → warning.
    let res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...baseEnv,
        CODEX_HOME: "/tmp/some/other",
        CODEX_ACCOUNT: "codex-account-b",
      },
      nothrow: true,
    })`${wrapper} --account codex-account-a exec go`;
    assert.equal(res.exitCode, 0, String(res.stderr));
    let log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`CODEX_HOME=${path.join(acctRoot, "codex-account-a")}`));
    assert.match(String(res.stderr), /overrides CODEX_HOME/);

    await fsp.writeFile(fake.log, "", "utf8");

    // Case 2: CODEX_HOME beats CODEX_ACCOUNT/default when --account absent.
    const explicit = path.join(tmp, "explicit-home");
    await fsp.mkdir(explicit, { recursive: true });
    res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...baseEnv,
        CODEX_HOME: explicit,
        CODEX_ACCOUNT: "codex-account-b",
      },
      nothrow: true,
    })`${wrapper} exec go`;
    assert.equal(res.exitCode, 0, String(res.stderr));
    log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`CODEX_HOME=${explicit}`));

    await fsp.writeFile(fake.log, "", "utf8");

    // Case 3: CODEX_ACCOUNT beats default symlink when CODEX_HOME/--account absent.
    res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...baseEnv,
        CODEX_ACCOUNT: "codex-account-b",
      },
      nothrow: true,
    })`${wrapper} exec go`;
    assert.equal(res.exitCode, 0, String(res.stderr));
    log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`CODEX_HOME=${path.join(acctRoot, "codex-account-b")}`));

    await fsp.writeFile(fake.log, "", "utf8");

    // Case 4: default symlink beats legacy when nothing else set.
    res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: baseEnv,
      nothrow: true,
    })`${wrapper} exec go`;
    assert.equal(res.exitCode, 0, String(res.stderr));
    log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`CODEX_HOME=${path.join(acctRoot, "codex-account-c")}`));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("legacy fallback used when ~/.codex-accounts/ is absent", async () => {
  const { tmp, home, gitRoot, fake, baseEnv } = await baseFixture();
  try {
    await fsp.mkdir(path.join(home, ".codex"), { recursive: true });
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: baseEnv,
      nothrow: true,
    })`${wrapper} exec go`;
    assert.equal(res.exitCode, 0, String(res.stderr));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`CODEX_HOME=${path.join(home, ".codex")}`));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("dangling default symlink falls through to legacy with warning", async () => {
  const { tmp, home, gitRoot, fake, baseEnv } = await baseFixture();
  try {
    const acctRoot = path.join(home, ".codex-accounts");
    await fsp.mkdir(acctRoot, { recursive: true });
    await fsp.symlink("nonexistent", path.join(acctRoot, "default"));
    await fsp.mkdir(path.join(home, ".codex"), { recursive: true });
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: baseEnv,
      nothrow: true,
    })`${wrapper} exec go`;
    assert.equal(res.exitCode, 0, String(res.stderr));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`CODEX_HOME=${path.join(home, ".codex")}`));
    assert.match(String(res.stderr), /does not exist/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
