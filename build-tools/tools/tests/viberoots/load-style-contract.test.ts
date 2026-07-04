#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
const $ = globalThis.$;

const repoRoot = process.cwd();

async function read(rel: string): Promise<string> {
  return await fsp.readFile(path.join(repoRoot, rel), "utf8");
}

async function trackedFiles(args: string[]): Promise<string[]> {
  const result = await $({ cwd: repoRoot, stdio: "pipe" })`git ls-files -- ${args}`;
  const files = String(result.stdout || "")
    .split("\n")
    .filter(Boolean);
  const existing: string[] = [];
  for (const file of files) {
    try {
      await fsp.access(path.join(repoRoot, file));
      existing.push(file);
    } catch {}
  }
  return existing;
}

function isViberootsOwnedBzl(file: string): boolean {
  return file.startsWith("build-tools/") && file.endsWith(".bzl");
}

test("viberoots-owned Starlark uses public self-loads and workspace provider maps", async () => {
  const files = (await trackedFiles(["build-tools"])).filter(isViberootsOwnedBzl);
  const rootLoadOffenders: string[] = [];
  const providerShimOffenders: string[] = [];

  for (const file of files) {
    const text = await read(file);
    if (/load\(\s*"\/\/build-tools/.test(text)) rootLoadOffenders.push(file);
    if (/load\(\s*"@viberoots\/\/build-tools\/lang:auto_map\.bzl"/.test(text)) {
      providerShimOffenders.push(file);
    }
  }

  assert.deepEqual(rootLoadOffenders, []);
  assert.deepEqual(providerShimOffenders, []);
});

test("project targets and scaffold templates use public viberoots loads", async () => {
  const files = (
    await trackedFiles(["projects", "viberoots/build-tools/tools/scaffolding/templates"])
  ).filter((file) => {
    const base = path.basename(file);
    return (
      base === "TARGETS" ||
      base === "TARGETS.jinja" ||
      file.endsWith(".bzl") ||
      file.endsWith(".bzl.jinja") ||
      file.endsWith("copier.yaml")
    );
  });
  const rootLoadOffenders: string[] = [];
  const providerShimOffenders: string[] = [];

  for (const file of files) {
    const text = await read(file);
    if (/load\(\s*"\/\/build-tools/.test(text)) rootLoadOffenders.push(file);
    if (/load\(\s*"@viberoots\/\/build-tools\/lang:auto_map\.bzl"/.test(text)) {
      providerShimOffenders.push(file);
    }
  }

  assert.deepEqual(rootLoadOffenders, []);
  assert.deepEqual(providerShimOffenders, []);
});

test("tracked Buck config exposes viberoots cell and preserves named cells", async () => {
  const text = await read(".buckconfig");
  for (const name of [
    "viberoots",
    "prelude",
    "toolchains",
    "repo_toolchains",
    "config",
    "fbsource",
    "fbcode",
  ]) {
    assert.match(text, new RegExp(`^${name}\\s*=`, "m"));
  }
});
