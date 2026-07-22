#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";
import { DEFAULT_AUTO_MAP_PATH, DEFAULT_PROVIDER_TARGETS_PATH } from "./workspace-state-paths";

const CXX_PROVIDER_TARGETS = [
  'load("@workspace_providers//:defs_cpp.bzl", "nix_cxx_library")',
  "",
  'nix_cxx_library(name = "nix_pkgs_googletest", attr = "pkgs.googletest")',
  'nix_cxx_library(name = "nix_pkgs_zlib", attr = "pkgs.zlib")',
  'nix_cxx_library(name = "nix_pkgs_openssl", attr = "pkgs.openssl")',
  "",
].join("\n");

const DEFS_CPP = [
  "def _nix_cxx_provider_impl(ctx):",
  '    out = ctx.actions.write(ctx.attrs.out, "cpp_provider:%s\\n" % ctx.attrs.attr)',
  "    return [DefaultInfo(default_output = out)]",
  "",
  "_nix_cxx_provider_rule = rule(",
  "    impl = _nix_cxx_provider_impl,",
  "    attrs = {",
  '        "attr": attrs.string(),',
  '        "out": attrs.string(),',
  '        "labels": attrs.list(attrs.string(), default = []),',
  "    },",
  ")",
  "",
  "def nix_cxx_provider(name, attr):",
  "    _nix_cxx_provider_rule(",
  "        name = name,",
  '        out = name + ".stamp",',
  "        attr = attr,",
  '        labels = ["lang:cpp", "nixpkg:%s" % attr],',
  '        visibility = ["PUBLIC"],',
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
  "def _node_importer_deps_impl(ctx):",
  "    out = ctx.actions.write(",
  "        ctx.attrs.out,",
  '        "node_importer:%s %s\\n" % (ctx.attrs.importer, ctx.attrs.lockfile),',
  "    )",
  "    return [DefaultInfo(default_output = out)]",
  "",
  "_node_importer_deps_rule = rule(",
  "    impl = _node_importer_deps_impl,",
  "    attrs = {",
  '        "lockfile": attrs.string(),',
  '        "importer": attrs.string(),',
  '        "patch_paths": attrs.list(attrs.string(), default = []),',
  '        "out": attrs.string(),',
  '        "labels": attrs.list(attrs.string(), default = []),',
  "    },",
  ")",
  "",
  "def node_importer_deps(name, lockfile, importer, patch_paths = []):",
  "    _node_importer_deps_rule(",
  "        name = name,",
  '        out = name + ".stamp",',
  "        lockfile = lockfile,",
  "        importer = importer,",
  "        patch_paths = patch_paths,",
  '        labels = ["lang:node"],',
  '        visibility = ["PUBLIC"],',
  "    )",
  "",
].join("\n");

const DEFS_PYTHON = [
  "def _python_importer_deps_impl(ctx):",
  "    out = ctx.actions.write(",
  "        ctx.attrs.out,",
  '        "python_importer:%s %s\\n" % (ctx.attrs.importer, ctx.attrs.lockfile),',
  "    )",
  "    return [DefaultInfo(default_output = out)]",
  "",
  "_python_importer_deps_rule = rule(",
  "    impl = _python_importer_deps_impl,",
  "    attrs = {",
  '        "lockfile": attrs.string(),',
  '        "importer": attrs.string(),',
  '        "patch_paths": attrs.list(attrs.string(), default = []),',
  '        "out": attrs.string(),',
  '        "labels": attrs.list(attrs.string(), default = []),',
  "    },",
  ")",
  "",
  "def python_importer_deps(name, lockfile, importer, patch_paths = []):",
  "    _python_importer_deps_rule(",
  "        name = name,",
  '        out = name + ".stamp",',
  "        lockfile = lockfile,",
  "        importer = importer,",
  "        patch_paths = patch_paths,",
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
    'load("//:defs_cpp.bzl", "nix_cxx_library")',
    'load("@workspace_providers//:defs_cpp.bzl", "nix_cxx_library")',
  );
  current = current.replaceAll(
    'load("//:defs_node.bzl", "node_importer_deps")',
    'load("@workspace_providers//:defs_node.bzl", "node_importer_deps")',
  );
  current = current.replaceAll(
    'load("//:defs_python.bzl", "python_importer_deps")',
    'load("@workspace_providers//:defs_python.bzl", "python_importer_deps")',
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
  await mkdirWithMacosMetadataExclusion(path.join(workspaceRoot, ".viberoots"));
  await mkdirWithMacosMetadataExclusion(path.dirname(path.dirname(targetsPath)));
  await mkdirWithMacosMetadataExclusion(path.dirname(targetsPath));
  await writeIfMissing(
    path.join(path.dirname(targetsPath), ".buckconfig"),
    "[buildfile]\nname = TARGETS\n",
  );
  await writeIfChanged(path.join(path.dirname(targetsPath), "defs_cpp.bzl"), DEFS_CPP);
  await writeIfChanged(path.join(path.dirname(targetsPath), "defs_node.bzl"), DEFS_NODE);
  await writeIfChanged(path.join(path.dirname(targetsPath), "defs_python.bzl"), DEFS_PYTHON);
  await ensureCuratedTargets(workspaceRoot);
  await writeIfMissing(autoMapPath, "MODULE_PROVIDERS = {}\n");
}
