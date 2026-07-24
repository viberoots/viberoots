#!/usr/bin/env zx-wrapper
// Tests for the guided setup path (unknown account name / --account-init).
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { binWrapper, scratchRoot, writeExecutable } from "./agent-wrapper-test-helpers.ts";
import { sanitizedAccountWrapperEnv } from "./codex-wrapper.accounts-test-fixture.ts";

const wrapper = binWrapper("codex");

async function fakeCodex(bin: string, log: string, exitCode: number): Promise<void> {
  await fsp.mkdir(bin, { recursive: true });
  await writeExecutable(
    path.join(bin, "codex"),
    `#!/usr/bin/env bash
printf 'codex %s\\n' "$*" >> ${JSON.stringify(log)}
printf 'CODEX_HOME=%s\\n' "\${CODEX_HOME:-}" >> ${JSON.stringify(log)}
exit ${exitCode}
`,
  );
}

test("non-interactive with unknown account and no init opt-in fails 66", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-init-"));
  try {
    const home = path.join(tmp, "home");
    const bin = path.join(tmp, "bin");
    const log = path.join(tmp, "calls.log");
    await fsp.mkdir(path.join(home, ".codex-accounts"), { recursive: true });
    await fakeCodex(bin, log, 0);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: sanitizedAccountWrapperEnv({
        HOME: home,
        CODEX_CLI_PATH: "",
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(bin, "codex"),
        PATH: `${path.dirname(wrapper)}:${bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
        VBR_CODEX_SAFEHOUSE: "0",
        VBR_CODEX_NONINTERACTIVE: "1",
      }),
      nothrow: true,
    })`${wrapper} --account codex-account-a exec go`;
    assert.equal(res.exitCode, 66);
    assert.match(String(res.stderr), /does not exist/);
    assert.match(String(res.stderr), /--account-init/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("--account-init with failing login removes new dir and exits 67", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-init-"));
  try {
    const home = path.join(tmp, "home");
    const bin = path.join(tmp, "bin");
    const log = path.join(tmp, "calls.log");
    await fsp.mkdir(path.join(home, ".codex-accounts"), { recursive: true });
    await fakeCodex(bin, log, 3);
    const target = path.join(home, ".codex-accounts", "codex-account-a");
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: sanitizedAccountWrapperEnv({
        HOME: home,
        CODEX_CLI_PATH: "",
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(bin, "codex"),
        PATH: `${path.dirname(wrapper)}:${bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
        VBR_CODEX_SAFEHOUSE: "0",
        VBR_CODEX_NONINTERACTIVE: "1",
      }),
      nothrow: true,
    })`${wrapper} --account codex-account-a --account-init exec go`;
    assert.equal(res.exitCode, 67);
    assert.match(String(res.stderr), /guided login failed/);
    await assert.rejects(fsp.stat(target), "target dir should be cleaned up on login failure");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("CODEX_ACCOUNT_INIT=1 substitutes for --account-init in non-interactive contexts", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-init-"));
  try {
    const home = path.join(tmp, "home");
    const bin = path.join(tmp, "bin");
    const log = path.join(tmp, "calls.log");
    await fsp.mkdir(path.join(home, ".codex-accounts"), { recursive: true });
    await fakeCodex(bin, log, 5); // Fail intentionally so we can observe the init branch.
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: sanitizedAccountWrapperEnv({
        HOME: home,
        CODEX_CLI_PATH: "",
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(bin, "codex"),
        PATH: `${path.dirname(wrapper)}:${bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
        VBR_CODEX_SAFEHOUSE: "0",
        VBR_CODEX_NONINTERACTIVE: "1",
        CODEX_ACCOUNT_INIT: "1",
      }),
      nothrow: true,
    })`${wrapper} --account codex-account-a exec go`;
    assert.equal(res.exitCode, 67); // Failed guided login.
    const calls = await fsp.readFile(log, "utf8").catch(() => "");
    assert.match(calls, /codex login/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
