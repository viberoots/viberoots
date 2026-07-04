#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  binWrapper,
  externalScratchRoot,
  makeFakeAgentTools,
} from "./agent-wrapper-test-helpers.ts";

const wrapper = binWrapper("codex");
const makeFakeTools = (tmp: string, gitRoot: string) => makeFakeAgentTools(tmp, gitRoot, "codex");

function managedCodexEnv(bin: string): Record<string, string> {
  return {
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(bin, "codex"),
  };
}

test("codex wrapper passes top-level help without default sandbox args", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        ...managedCodexEnv(fake.bin),
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} --help`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /codex --help/);
    assert.doesNotMatch(log, /danger-full-access/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper launches the main repo with full-access sandbox by default", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        ...managedCodexEnv(fake.bin),
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} exec parent`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.doesNotMatch(log, /safehouse /);
    assert.match(log, /codex --sandbox danger-full-access exec parent/);
    assert.doesNotMatch(log, /dangerously-bypass-approvals-and-sandbox/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper preserves an explicit sandbox argument", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        ...managedCodexEnv(fake.bin),
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH}`,
      },
    })`${wrapper} --sandbox workspace-write exec parent`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /codex --sandbox workspace-write exec parent/);
    assert.doesNotMatch(log, /danger-full-access/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
