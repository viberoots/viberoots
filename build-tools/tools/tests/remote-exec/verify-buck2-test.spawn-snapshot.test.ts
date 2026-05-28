#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnVerifyBuck2Tests } from "../../dev/verify/buck2-test";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import {
  localArgvSnapshot,
  normalizeSpawnArg,
  remoteArgvSnapshot,
  type RemoteMode,
} from "./verify-buck2-test.spawn-snapshot-fixtures";

type SpawnCall = {
  command: string;
  args: string[];
  options: { cwd?: string; env?: NodeJS.ProcessEnv; detached?: boolean };
};

type Snapshot = {
  artifactDir: string;
  buckConfig: string;
  call: SpawnCall;
};

const remoteEnv = {
  VBR_REMOTE_ARTIFACT_DIR: "/tmp/vbr-remote/artifacts",
  VBR_REMOTE_BUCK_CONFIG: "/tmp/vbr-remote/buckconfig",
  VBR_REMOTE_EXEC_SYSTEM: "x86_64-linux",
};

function captureSpawn(calls: SpawnCall[]) {
  return ((command: string, args: string[], options: SpawnCall["options"]) => {
    calls.push({
      command: path.basename(command),
      args: args.map(normalizeSpawnArg),
      options,
    });
    const proc = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.pid = 12345;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }) as typeof import("node:child_process").spawn;
}

function spawnedEnvSnapshot(call: SpawnCall): Record<string, string | undefined> {
  return {
    BUCK_LOG: call.options.env?.BUCK_LOG,
    RUST_LOG: call.options.env?.RUST_LOG,
    VBR_VERIFY_REGISTER_PROCESS: call.options.env?.VBR_VERIFY_REGISTER_PROCESS,
  };
}

function spawnSnapshot(mode: "local" | RemoteMode): Snapshot {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vbr-spawn-snapshot-"));
  const artifactDir = path.join(tmp, "artifacts");
  const buckConfig = path.join(tmp, "remote.buckconfig");
  fs.writeFileSync(buckConfig, "remote = true\n", "utf8");
  const calls: SpawnCall[] = [];
  const policy = parseVerifyExecutionPolicy({
    env:
      mode === "local"
        ? {}
        : {
            ...remoteEnv,
            VBR_REMOTE_ARTIFACT_DIR: artifactDir,
            VBR_REMOTE_BUCK_CONFIG: buckConfig,
            VBR_REMOTE_EXEC_MODE: mode,
          },
  });

  const prev = { ...process.env };
  Object.assign(process.env, {
    BUCK_LOG: "warn,buck2_event_log::writer=off,buck2_execute=trace",
    NIX_PATH: "",
    RUST_LOG: "info,buck2_event_log::writer=off,buck2_client_ctx=debug",
    VBR_BUCK_REAPER_STATE_FILE: "",
    VBR_SHARED_PRELUDE_PATH: "",
    VBR_TEST_SEED_KEY: "",
    VBR_TEST_SEED_PIN_DIR: "",
    VBR_TEST_SEED_STORE_PATH: "",
    VBR_VERIFY_LOCK_DIR: "",
    VBR_VERIFY_LOG_FILE: "",
    VBR_VERIFY_PROCESS_STATE_FILE: "",
    VERIFY_TIMEOUT_SECS: "7200",
  });
  try {
    spawnVerifyBuck2Tests({
      root: tmp,
      iso: "v-test",
      logFile: null,
      console: "simple",
      targets: ["//:target"],
      zxNodeModulesOut: null,
      threadsOverride: 3,
      passName: "shared",
      executionPolicy: policy,
      spawnImpl: captureSpawn(calls),
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prev)) delete process.env[key];
    Object.assign(process.env, prev);
  }
  return { artifactDir, buckConfig, call: calls[0] };
}

test("spawnVerifyBuck2Tests local argv/env snapshot is unchanged", () => {
  const { call } = spawnSnapshot("local");

  assert.deepEqual(call.args, localArgvSnapshot());
  assert.deepEqual(spawnedEnvSnapshot(call), {
    BUCK_LOG:
      "warn,buck2_event_log::writer=off,buck2_execute=trace,buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
    RUST_LOG:
      "info,buck2_event_log::writer=off,buck2_client_ctx=debug,buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
    VBR_VERIFY_REGISTER_PROCESS: undefined,
  });
});

test("spawnVerifyBuck2Tests remote argv/env snapshots cover every mode", () => {
  for (const mode of ["hybrid", "remote", "remote-only-conformance"] as const) {
    const { artifactDir, buckConfig, call } = spawnSnapshot(mode);
    assert.deepEqual(call.args, remoteArgvSnapshot({ artifactDir, buckConfig, mode }));
    assert.deepEqual(spawnedEnvSnapshot(call), {
      BUCK_LOG: "warn,buck2_execute=trace",
      RUST_LOG: "info,buck2_client_ctx=debug",
      VBR_VERIFY_REGISTER_PROCESS: undefined,
    });
  }
});
