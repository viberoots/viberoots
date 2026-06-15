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

const DEFS_CPP = [
  'load("@prelude//:rules.bzl", "genrule")',
  "",
  "def nix_cxx_provider(name, attr):",
  "    genrule(",
  "        name = name,",
  "        srcs = [],",
  '        out = name + ".stamp",',
  '        cmd = "echo cpp_provider:${attr} > $OUT",',
  '        labels = ["lang:cpp", "nixpkg:%s" % attr],',
  '        visibility = ["//visibility:public"],',
  "    )",
  "",
  "def nix_cxx_library(name, attr, headers_subdir = None, static = True, shared = False):",
  "    nix_cxx_provider(name = name, attr = attr)",
  "",
  "def nix_cxx_gtest_providers():",
  '    nix_cxx_provider(name = "nix_pkgs_googletest", attr = "pkgs.googletest")',
  "",
].join("\n");

const DEFS_NODE = [
  'load("@prelude//:rules.bzl", "genrule")',
  "",
  "def node_importer_deps(name, lockfile, importer, patch_paths = []):",
  "    genrule(",
  "        name = name,",
  "        srcs = [],",
  '        out = name + ".stamp",',
  '        cmd = "echo node_importer:${importer} ${lockfile} > $OUT",',
  '        labels = ["lang:node"],',
  '        visibility = ["PUBLIC"],',
  "    )",
  "",
].join("\n");

const DEFS_PYTHON = [
  'load("@prelude//:rules.bzl", "genrule")',
  "",
  "def python_importer_deps(name, lockfile, importer, patch_paths = []):",
  "    genrule(",
  "        name = name,",
  "        srcs = [],",
  '        out = name + ".stamp",',
  '        cmd = "echo python_importer:${importer} ${lockfile} > $OUT",',
  '        labels = ["lang:python"],',
  '        visibility = ["PUBLIC"],',
  "    )",
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
  current = current.replaceAll(
    'load("@workspace_providers//:defs_cpp.bzl", "nix_cxx_library")',
    'load("//:defs_cpp.bzl", "nix_cxx_library")',
  );
  current = current.replaceAll(
    'load("@workspace_providers//:defs_node.bzl", "node_importer_deps")',
    'load("//:defs_node.bzl", "node_importer_deps")',
  );
  current = current.replaceAll(
    'load("@workspace_providers//:defs_python.bzl", "python_importer_deps")',
    'load("//:defs_python.bzl", "python_importer_deps")',
  );
  if (!current.trim()) {
    await writeIfChanged(targetsPath, CXX_PROVIDER_TARGETS);
    return;
  }
  if (current.includes("nix_pkgs_googletest")) {
    await writeIfChanged(targetsPath, current);
    return;
  }
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
  await writeIfMissing(path.join(path.dirname(targetsPath), "defs_cpp.bzl"), DEFS_CPP);
  await writeIfMissing(path.join(path.dirname(targetsPath), "defs_node.bzl"), DEFS_NODE);
  await writeIfMissing(path.join(path.dirname(targetsPath), "defs_python.bzl"), DEFS_PYTHON);
  await ensureCuratedTargets(workspaceRoot);
  await writeIfMissing(autoMapPath, "MODULE_PROVIDERS = {}\n");
}
