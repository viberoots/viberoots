#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { buildToolPath } from "../../dev/dev-build/paths";

async function runNodeWithVerifyEnv(env: NodeJS.ProcessEnv): Promise<number> {
  const zxInit = buildToolPath(process.cwd(), "tools/dev/zx-init.mjs");
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--import", zxInit, "-e", ""],
    {
      cwd: process.cwd(),
      env,
      stdio: "ignore",
    },
  );
  return await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
}

async function runNodeScript(
  script: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const zxInit = buildToolPath(process.cwd(), "tools/dev/zx-init.mjs");
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--import", zxInit, script],
    {
      cwd: process.cwd(),
      env,
      stdio: "ignore",
    },
  );
  return await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
}

async function runNodeScriptWithOutput(
  script: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: { cwd?: string; eval?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const zxInit = buildToolPath(process.cwd(), "tools/dev/zx-init.mjs");
  const child = spawn(
    process.execPath,
    opts.eval
      ? ["--experimental-strip-types", "--import", zxInit, "--input-type=module", "--eval", script]
      : ["--experimental-strip-types", "--import", zxInit, script],
    {
      cwd: opts.cwd || process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [code] = (await once(child, "close")) as [number | null];
  return { code: typeof code === "number" ? code : 1, stdout, stderr };
}

test("zx-init resolves repo node_modules when the child cwd is outside the repo", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zx-init-repo-node-modules-"));
  try {
    const env = { ...process.env, NODE_PATH: "" };
    const result = await runNodeScriptWithOutput(
      "import fs from 'fs-extra'; console.log(typeof fs.pathExists);",
      env,
      { cwd: dir, eval: true },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), "function");
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("zx-init registers verify-owned processes only when explicitly opted in", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zx-init-verify-registration-"));
  const stateFile = path.join(dir, "state.txt");
  const logFile = path.join(dir, "verify.log");
  await fsp.writeFile(stateFile, "", "utf8");
  await fsp.writeFile(logFile, "", "utf8");

  try {
    const baseEnv = {
      ...process.env,
      VBR_VERIFY_PROCESS_STATE_FILE: stateFile,
      VBR_VERIFY_LOG_FILE: logFile,
    };
    delete baseEnv.BUCK_ISOLATION_DIR;
    delete baseEnv.BUCK_NESTED_ISO;
    const noTargetEnv = { ...baseEnv };
    delete noTargetEnv.BUCK_TEST_TARGET;
    assert.equal(await runNodeWithVerifyEnv(noTargetEnv), 0);
    assert.equal(await fsp.readFile(stateFile, "utf8"), "");

    assert.equal(
      await runNodeWithVerifyEnv({
        ...baseEnv,
        BUCK_TEST_TARGET: "root//:zx_init_verify_registration",
      }),
      0,
    );
    assert.equal(await fsp.readFile(stateFile, "utf8"), "");

    assert.equal(
      await runNodeWithVerifyEnv({
        ...baseEnv,
        VBR_VERIFY_REGISTER_PROCESS: "1",
        BUCK_TEST_TARGET: "root//:zx_init_verify_registration",
      }),
      0,
    );
    assert.match(await fsp.readFile(stateFile, "utf8"), /^process\t/m);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("zx-init consumes verify-owned process registration opt-in before spawning children", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zx-init-verify-registration-once-"));
  const stateFile = path.join(dir, "state.txt");
  const logFile = path.join(dir, "verify.log");
  const script = path.join(dir, "spawn-child.ts");
  await fsp.writeFile(stateFile, "", "utf8");
  await fsp.writeFile(logFile, "", "utf8");

  try {
    await fsp.writeFile(
      script,
      [
        'import { spawn } from "node:child_process";',
        'import { once } from "node:events";',
        'import path from "node:path";',
        "const zxInit = path.join(process.cwd(), 'build-tools', 'tools', 'dev', 'zx-init.mjs');",
        "const child = spawn(process.execPath, ['--experimental-strip-types', '--import', zxInit, '-e', ''], {",
        "  cwd: process.cwd(),",
        "  env: process.env,",
        "  stdio: 'ignore',",
        "});",
        "const [code] = await once(child, 'close');",
        "process.exit(typeof code === 'number' ? code : 1);",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runNodeScriptWithOutput(script, {
      ...process.env,
      VBR_VERIFY_PROCESS_STATE_FILE: stateFile,
      VBR_VERIFY_LOG_FILE: logFile,
      VBR_VERIFY_REGISTER_PROCESS: "1",
      BUCK_TEST_TARGET: "root//:zx_init_verify_registration_once",
    });
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const records = (await fsp.readFile(stateFile, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.startsWith("process\t"));
    assert.equal(records.length, 1);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("zx-init registers nested buck isolation against verify owner", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zx-init-buck-isolation-registration-"));
  const stateFile = path.join(dir, "state.txt");
  const logFile = path.join(dir, "verify.log");
  await fsp.writeFile(stateFile, "", "utf8");
  await fsp.writeFile(logFile, "", "utf8");

  try {
    assert.equal(
      await runNodeWithVerifyEnv({
        ...process.env,
        VBR_VERIFY_PROCESS_STATE_FILE: stateFile,
        VBR_VERIFY_LOG_FILE: logFile,
        VBR_VERIFY_OWNER_PID: String(process.pid),
        BUCK_NESTED_ISO: "zxtest-shared-deadbeef12",
        WORKSPACE_ROOT: process.cwd(),
      }),
      0,
    );
    const txt = await fsp.readFile(stateFile, "utf8");
    assert.match(txt, /^isolation\t/m);
    assert.match(txt, /"iso":"zxtest-shared-deadbeef12"/);
    assert.match(txt, /"kind":"zx-test-nested"/);
    assert.match(txt, new RegExp(`"ownerPid":${process.pid}`));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("zx-init resolves extensionless dotted TypeScript helper modules", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zx-init-dotted-helper-"));
  const entry = path.join(dir, "entry.ts");
  const helper = path.join(dir, "local.fixture.ts");
  try {
    await fsp.writeFile(helper, "export const value = 42;\n", "utf8");
    await fsp.writeFile(
      entry,
      [
        'import assert from "node:assert/strict";',
        'import { value } from "./local.fixture";',
        "assert.equal(value, 42);",
        "",
      ].join("\n"),
      "utf8",
    );
    assert.equal(await runNodeScript(entry), 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
