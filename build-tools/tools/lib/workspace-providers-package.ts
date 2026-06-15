#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";
import { DEFAULT_AUTO_MAP_PATH, DEFAULT_PROVIDER_TARGETS_PATH } from "./workspace-state-paths";

const CXX_PROVIDER_TARGETS = [
  'load("//:defs_cpp.bzl", "nix_cxx_library")',
  "",
  'nix_cxx_library(name = "nix_pkgs_googletest", attr = "pkgs.googletest")',
  'nix_cxx_library(name = "nix_pkgs_zlib", attr = "pkgs.zlib")',
  'nix_cxx_library(name = "nix_pkgs_openssl", attr = "pkgs.openssl")',
  "",
].join("\n");

async function writeIfMissing(file: string, text: string): Promise<void> {
  try {
    await fsp.access(file);
  } catch {
    await writeIfChanged(file, text);
  }
}

async function ensureCuratedTargets(workspaceRoot: string): Promise<void> {
  const targetsPath = path.join(workspaceRoot, DEFAULT_PROVIDER_TARGETS_PATH);
  let current = "";
  try {
    current = await fsp.readFile(targetsPath, "utf8");
  } catch {}
  if (!current.trim()) {
    await writeIfChanged(targetsPath, CXX_PROVIDER_TARGETS);
    return;
  }
  if (current.includes("nix_pkgs_googletest")) return;
  await writeIfChanged(targetsPath, `${CXX_PROVIDER_TARGETS}\n${current}`);
}

export async function ensureWorkspaceProvidersPackage(
  workspaceRoot = process.cwd(),
): Promise<void> {
  const targetsPath = path.join(workspaceRoot, DEFAULT_PROVIDER_TARGETS_PATH);
  const autoMapPath = path.join(workspaceRoot, DEFAULT_AUTO_MAP_PATH);
  await fsp.mkdir(path.dirname(targetsPath), { recursive: true });
  await writeIfMissing(
    path.join(path.dirname(targetsPath), ".buckconfig"),
    "[buildfile]\nname = TARGETS\n",
  );
  await ensureCuratedTargets(workspaceRoot);
  await writeIfMissing(autoMapPath, "MODULE_PROVIDERS = {}\n");
}
