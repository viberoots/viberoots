#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  binWrapper,
  escapeRegExp,
  externalScratchRoot,
  makeFakeAgentTools,
  repoRoot,
  safehouseLaunchPattern,
  scratchRoot,
  writeExecutable,
} from "./agent-wrapper-test-helpers.ts";

const wrapper = binWrapper("codex");
const makeFakeTools = (tmp: string, gitRoot: string) => makeFakeAgentTools(tmp, gitRoot, "codex");

function managedCodexEnv(bin: string): Record<string, string> {
  return {
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(bin, "codex"),
  };
}

test("codex wrapper uses only the managed Codex from PATH", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const unmanagedBin = path.join(tmp, "unmanaged-bin");
    const fake = await makeFakeTools(tmp, gitRoot);
    await fsp.mkdir(gitRoot, { recursive: true });
    await fsp.mkdir(unmanagedBin, { recursive: true });
    await writeExecutable(
      path.join(unmanagedBin, "codex"),
      `#!/usr/bin/env bash\nprintf 'unmanaged-codex %s\\n' "$*" >> ${JSON.stringify(fake.log)}\n`,
    );
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        ...managedCodexEnv(fake.bin),
        PATH: `${path.dirname(wrapper)}:${unmanagedBin}:${fake.bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} exec host-path`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.doesNotMatch(log, /safehouse /);
    assert.doesNotMatch(log, /unmanaged-codex/);
    assert.match(log, /codex --sandbox danger-full-access exec host-path/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper resolves managed Codex from VIBEROOTS_NODE_PATH", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const nodeModules = path.join(tmp, "managed-node", "node_modules");
    const bin = path.join(nodeModules, ".bin");
    const log = path.join(tmp, "calls.log");
    await fsp.mkdir(gitRoot, { recursive: true });
    await fsp.mkdir(bin, { recursive: true });
    await writeExecutable(
      path.join(bin, "codex"),
      `#!/usr/bin/env bash\nprintf 'node-path-codex %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
    );

    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        CODEX_CLI_PATH: "",
        VIBEROOTS_NODE_PATH: nodeModules,
        PATH: `${path.dirname(wrapper)}:${bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} exec node-path`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const calls = await fsp.readFile(log, "utf8");
    assert.match(calls, /node-path-codex --sandbox danger-full-access exec node-path/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper accepts source-root managed Codex when VIBEROOTS_NODE_PATH changed in a stale shell", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const sourceRoot = path.join(tmp, "source");
    const wrapperDir = path.join(sourceRoot, "build-tools", "tools", "bin");
    const wrapperCopy = path.join(wrapperDir, "codex");
    const sourceNodeModules = path.join(sourceRoot, "node_modules");
    const sourceBin = path.join(sourceNodeModules, ".bin");
    const staleNodeModules = path.join(tmp, "stale-node", "node_modules");
    const staleBin = path.join(staleNodeModules, ".bin");
    const log = path.join(tmp, "calls.log");
    await fsp.mkdir(wrapperDir, { recursive: true });
    await fsp.mkdir(sourceBin, { recursive: true });
    await fsp.mkdir(staleBin, { recursive: true });
    await fsp.copyFile(wrapper, wrapperCopy);
    await fsp.chmod(wrapperCopy, 0o755);
    await writeExecutable(
      path.join(sourceBin, "codex"),
      `#!/usr/bin/env bash\nprintf 'source-managed-codex %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
    );
    await writeExecutable(
      path.join(staleBin, "codex"),
      `#!/usr/bin/env bash\nprintf 'node-path-codex %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
    );

    const res = await $({
      cwd: sourceRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        CODEX_CLI_PATH: "",
        VIBEROOTS_NODE_PATH: staleNodeModules,
        PATH: `${wrapperDir}:${sourceBin}:/usr/bin:/bin`,
      },
    })`${wrapperCopy} exec stale-shell`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const calls = await fsp.readFile(log, "utf8");
    assert.match(calls, /source-managed-codex --sandbox danger-full-access exec stale-shell/);
    assert.doesNotMatch(calls, /node-path-codex/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper accepts CODEX_CLI_PATH only when it is the managed Codex", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const fake = await makeFakeTools(tmp, gitRoot);
    await fsp.mkdir(gitRoot, { recursive: true });
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        CODEX_CLI_PATH: path.join(fake.bin, "codex"),
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
        PATH: `${path.dirname(wrapper)}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} resume`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /codex --sandbox danger-full-access resume/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper rejects unmanaged CODEX_CLI_PATH instead of redirecting", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const unmanagedBin = path.join(tmp, "unmanaged-bin");
    await fsp.mkdir(gitRoot, { recursive: true });
    await fsp.mkdir(unmanagedBin, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    await writeExecutable(
      path.join(unmanagedBin, "codex"),
      `#!/usr/bin/env bash\nprintf 'unmanaged-codex %s\\n' "$*" >> ${JSON.stringify(fake.log)}\n`,
    );

    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      nothrow: true,
      env: {
        ...process.env,
        CODEX_CLI_PATH: path.join(unmanagedBin, "codex"),
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} exec explicit`;

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr), /CODEX_CLI_PATH must point to the viberoots-managed Codex/);
    const log = await fsp.readFile(fake.log, "utf8").catch(() => "");
    assert.doesNotMatch(log, /unmanaged-codex/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper rejects app Codex paths instead of falling back", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const appCli = path.join(tmp, "Applications", "Codex.app", "Contents", "Resources", "codex");
    await fsp.mkdir(gitRoot, { recursive: true });
    await fsp.mkdir(path.dirname(appCli), { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    await writeExecutable(
      appCli,
      `#!/usr/bin/env bash\nprintf 'app-codex %s\\n' "$*" >> ${JSON.stringify(fake.log)}\n`,
    );

    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      nothrow: true,
      env: {
        ...process.env,
        CODEX_CLI_PATH: appCli,
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} exec app`;

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr), /Refusing unmanaged Codex path/);
    const log = await fsp.readFile(fake.log, "utf8").catch(() => "");
    assert.doesNotMatch(log, /^app-codex /m);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper rejects transient arg0 Codex shims instead of falling back", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const home = path.join(tmp, "home");
    const bin = path.join(home, ".codex", "tmp", "arg0", "session", "bin");
    const managedBin = path.join(tmp, "managed-bin");
    const log = path.join(tmp, "calls.log");
    await fsp.mkdir(gitRoot, { recursive: true });
    await fsp.mkdir(bin, { recursive: true });
    await fsp.mkdir(managedBin, { recursive: true });
    await fsp.writeFile(
      path.join(bin, ".codex-wrapped"),
      `#!/usr/bin/env bash\nprintf '%s %s\\n' "$(basename -- "$0")" "$*" >> ${JSON.stringify(log)}\n`,
      { mode: 0o755 },
    );
    await writeExecutable(
      path.join(bin, "codex"),
      `#!/usr/bin/env bash\nprintf 'transient-codex %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
    );
    await writeExecutable(
      path.join(managedBin, "codex"),
      `#!/usr/bin/env bash\nprintf 'managed-codex %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
    );
    await fsp.symlink(".codex-wrapped", path.join(bin, "codex-execve-wrapper"));
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      nothrow: true,
      env: {
        ...process.env,
        HOME: home,
        CODEX_CLI_PATH: "",
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(managedBin, "codex"),
        PATH: `${path.dirname(wrapper)}:${bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} --version`;

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr), /viberoots-managed Codex is not on PATH/);
    const calls = await fsp.readFile(log, "utf8").catch(() => "");
    assert.doesNotMatch(calls, /transient-codex|codex-wrapped|managed-codex/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper fails clearly when managed Codex is missing", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      nothrow: true,
      env: {
        ...process.env,
        CODEX_CLI_PATH: "",
        VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(tmp, "missing", "codex"),
        PATH: `${path.dirname(wrapper)}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} exec missing`;

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr), /viberoots-managed Codex is missing or not executable/);
    assert.match(String(res.stderr), /reload the viberoots dev shell or run 'i'/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
