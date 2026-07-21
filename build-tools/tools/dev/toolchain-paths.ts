#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../lib/fs-helpers";
import { repoRoot } from "../lib/repo";
import { isVbrVerbose } from "../lib/command-ui";
import { toolchainBzlPaths } from "./workspace-toolchains";
import { renderToolchainBzl } from "./toolchain-paths-render";

type ToolchainPaths = {
  artifactTools: { root: string };
  go: { bin: string; root: string };
  python: { bin: string };
  zxWrapper: { bin: string };
};

function toolchainJsonPath(root: string): string {
  return path.join(root, ".viberoots", "workspace", "toolchain-paths.json");
}

async function workspaceFlakeRef(root: string): Promise<{
  flakeRef: string;
}> {
  const parentRoot = path.dirname(root);
  if (path.basename(root) === "viberoots") {
    const parentHidden = path.join(parentRoot, ".viberoots", "workspace", "flake.nix");
    const hasParentWorkspace = await fsp
      .access(parentHidden)
      .then(() => true)
      .catch(() => false);
    if (hasParentWorkspace) return { flakeRef: `path:${path.dirname(parentHidden)}` };
  }
  const hidden = path.join(root, ".viberoots", "workspace", "flake.nix");
  const hasWorkspace = await fsp
    .access(hidden)
    .then(() => true)
    .catch(() => false);
  if (hasWorkspace) return { flakeRef: `path:${path.dirname(hidden)}` };
  throw new Error(
    `toolchain paths require generated ${path.join(
      root,
      ".viberoots",
      "workspace",
      "flake.nix",
    )}; run viberoots bootstrap or post-clone first`,
  );
}

function isNixStorePath(p: string): boolean {
  return p === "/nix/store" || p.startsWith("/nix/store/");
}

function logToolchainProgress(message: string): void {
  if (isVbrVerbose()) console.error(message);
}

async function nixPathInfo(root: string, attr: string, sourceRef = ""): Promise<string> {
  const flakeRef = sourceRef || (await workspaceFlakeRef(root)).flakeRef;
  logToolchainProgress(`[toolchain-paths] checking ${attr} in Nix store`);
  const res = await $({
    cwd: root,
    stdio: "pipe",
  })`nix path-info ${`${flakeRef}#${attr}`} --json --accept-flake-config`
    .quiet()
    .nothrow();
  if (res.exitCode !== 0) return "";
  const txt = String(res.stdout || "").trim();
  if (!txt.startsWith("[")) return "";
  try {
    const arr = JSON.parse(txt) as Array<string | { path?: string; valid?: boolean }>;
    const first = arr[0];
    const out = (typeof first === "string" ? first : String(first?.path || "")).trim();
    if (!out) return "";
    if (typeof first !== "string" && first?.valid === false) return "";
    try {
      await fsp.access(out);
      return out;
    } catch {
      return "";
    }
  } catch {
    return "";
  }
}

async function nixBuildOutPath(root: string, attr: string, sourceRef = ""): Promise<string> {
  const flakeRef = sourceRef || (await workspaceFlakeRef(root)).flakeRef;
  logToolchainProgress(`[toolchain-paths] realizing ${attr} with nix build`);
  const res = await $({
    cwd: root,
    stdio: "pipe",
  })`nix build ${`${flakeRef}#${attr}`} --no-link --print-out-paths --accept-flake-config`.quiet();
  const out =
    String(res.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || "";
  if (!out) {
    throw new Error(`nix build returned no output path for ${attr}`);
  }
  return out;
}

async function resolveToolchainOut(root: string, attr: string, sourceRef = ""): Promise<string> {
  const info = await nixPathInfo(root, attr, sourceRef);
  if (info) return info;
  return await nixBuildOutPath(root, attr, sourceRef);
}

async function resolveGoRoot(goBin: string): Promise<string> {
  try {
    const res = await $({ stdio: "pipe" })`${goBin} env GOROOT`;
    return String(res.stdout || "").trim();
  } catch {
    return "";
  }
}

async function writeGeneratedIfWritable(file: string, data: string): Promise<void> {
  try {
    await writeIfChanged(file, data);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code || "";
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") return;
    throw e;
  }
}

async function readExistingToolchainPaths(repo: string): Promise<ToolchainPaths | null> {
  const jsonPath = toolchainJsonPath(repo);
  let raw = "";
  try {
    raw = await fsp.readFile(jsonPath, "utf8");
  } catch {
    return null;
  }
  const txt = raw.trim();
  if (!txt) return null;
  try {
    const parsed = JSON.parse(txt) as Partial<ToolchainPaths>;
    const goBin = String(parsed?.go?.bin || "").trim();
    const goRoot = String(parsed?.go?.root || "").trim();
    const pyBin = String(parsed?.python?.bin || "").trim();
    const zxWrapperBin = String(parsed?.zxWrapper?.bin || "").trim();
    const artifactToolsRoot = String(parsed?.artifactTools?.root || "").trim();
    if (!goBin || !pyBin || !zxWrapperBin || !artifactToolsRoot) return null;
    if (
      !isNixStorePath(goBin) ||
      !isNixStorePath(pyBin) ||
      !isNixStorePath(zxWrapperBin) ||
      !isNixStorePath(artifactToolsRoot)
    ) {
      return null;
    }
    try {
      await fsp.access(goBin);
      await fsp.access(pyBin);
      await fsp.access(zxWrapperBin);
      await fsp.access(path.join(artifactToolsRoot, "bin", "bash"));
    } catch {
      return null;
    }
    const root = goRoot || (await resolveGoRoot(goBin)) || "";
    if (!root || !isNixStorePath(root)) return null;
    try {
      await fsp.access(root);
    } catch {
      return null;
    }
    const out: ToolchainPaths = {
      artifactTools: { root: artifactToolsRoot },
      go: { bin: goBin, root },
      python: { bin: pyBin },
      zxWrapper: { bin: zxWrapperBin },
    };
    await writeGeneratedIfWritable(jsonPath, JSON.stringify(out, null, 2) + "\n");
    for (const bzlPath of await toolchainBzlPaths(repo)) {
      await writeGeneratedIfWritable(bzlPath, renderToolchainBzl(out));
    }
    return out;
  } catch {
    return null;
  }
}

export async function ensureToolchainPathsFiles(
  root?: string,
  opts: { refresh?: boolean; artifactToolsFlakeRef?: string } = {},
): Promise<ToolchainPaths> {
  const repo = root || repoRoot();
  const existing = opts.refresh ? null : await readExistingToolchainPaths(repo);
  if (existing) return existing;
  const goOut = await resolveToolchainOut(repo, "toolchains.go");
  const pyOut = await resolveToolchainOut(repo, "toolchains.python");
  const zxWrapperOut = await resolveToolchainOut(repo, "zx-wrapper");
  const artifactToolsRoot = await resolveToolchainOut(
    repo,
    "remote-worker-tools",
    opts.artifactToolsFlakeRef,
  );
  const goBin = path.join(goOut, "bin", "go");
  const pyBin = path.join(pyOut, "bin", "python3");
  const zxWrapperBin = path.join(zxWrapperOut, "bin", "zx-wrapper");
  if (
    !isNixStorePath(goOut) ||
    !isNixStorePath(pyOut) ||
    !isNixStorePath(zxWrapperOut) ||
    !isNixStorePath(artifactToolsRoot)
  ) {
    throw new Error(
      `expected Nix store toolchains; got go=${goOut || "<missing>"} python=${
        pyOut || "<missing>"
      } zx-wrapper=${zxWrapperOut || "<missing>"} artifact-tools=${artifactToolsRoot || "<missing>"}`,
    );
  }
  const goRoot = (await resolveGoRoot(goBin)) || path.join(goOut, "share", "go");
  const pathsObj: ToolchainPaths = {
    artifactTools: { root: artifactToolsRoot },
    go: { bin: goBin, root: goRoot },
    python: { bin: pyBin },
    zxWrapper: { bin: zxWrapperBin },
  };
  const jsonPath = toolchainJsonPath(repo);
  await writeGeneratedIfWritable(jsonPath, JSON.stringify(pathsObj, null, 2) + "\n");
  for (const bzlPath of await toolchainBzlPaths(repo)) {
    await writeGeneratedIfWritable(bzlPath, renderToolchainBzl(pathsObj));
  }
  return pathsObj;
}
