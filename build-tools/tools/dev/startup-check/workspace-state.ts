import * as fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { findExtractionBlockers, formatExtractionBlockers } from "../../lib/extraction-blockers";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p: string): Promise<string> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return "";
  }
}

function flakeUsesLocalViberoots(text: string): boolean {
  return /viberoots\.url\s*=\s*"(?:path|git\+file):[^"]*viberoots"/.test(text);
}

function flakeUsesSubmoduleViberoots(text: string): boolean {
  return /viberoots\.url\s*=\s*"(?:path|git\+file):(?:\.\/|\.\.\/\.\.\/)?viberoots"/.test(
    text,
  );
}

async function readWorkspaceFlakeText(): Promise<string> {
  const hidden = await readText(path.join(".viberoots", "workspace", "flake.nix"));
  if (hidden) return hidden;
  return await readText("flake.nix");
}

async function readWorkspaceFlakeLock(): Promise<{ text: string; dir: string }> {
  const hiddenPath = path.join(".viberoots", "workspace", "flake.lock");
  const hidden = await readText(hiddenPath);
  if (hidden) return { text: hidden, dir: path.dirname(hiddenPath) };
  return { text: await readText("flake.lock"), dir: "." };
}

async function git(args: string[], cwd = "."): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return String(stdout || "").trim();
  } catch {
    return "";
  }
}

async function requireBuckroot(): Promise<void> {
  if (!(await exists(".buckroot"))) throw new Error("[startup-check] .buckroot not found");
}

async function requireLocalViberootsFlake(flakeText: string): Promise<void> {
  if (!flakeUsesSubmoduleViberoots(flakeText)) return;
  if (!(await exists("viberoots/flake.nix"))) {
    throw new Error(
      "[startup-check] viberoots submodule is missing or uninitialized; run `git submodule update --init viberoots`",
    );
  }
}

async function requireLocalFlakeLock(flakeText: string): Promise<void> {
  if (!flakeUsesLocalViberoots(flakeText)) return;
  try {
    const expectedViberootsPaths = new Set([path.resolve("viberoots")]);
    for (const candidate of [
      process.env.VIBEROOTS_SOURCE_ROOT || "",
      process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "",
    ]) {
      const trimmed = String(candidate).trim();
      if (trimmed) expectedViberootsPaths.add(path.resolve(trimmed));
    }
    const { text: lockText, dir: lockDir } = await readWorkspaceFlakeLock();
    const lock = JSON.parse(lockText);
    const node = lock?.nodes?.viberoots || lock?.nodes?.viberootsInput;
    const locked = node?.locked || {};
    const original = node?.original || {};
    const resolveLockPath = (p: unknown): string =>
      typeof p === "string" && p ? path.resolve(lockDir, p) : "";
    if (
      (locked.type === "path" &&
        (locked.path === "./viberoots" || locked.path === "../../viberoots") &&
        original.type === "path" &&
        (original.path === "./viberoots" || original.path === "../../viberoots")) ||
      (locked.type === "git" &&
        (locked.url === "file:./viberoots" || locked.url === "file:../../viberoots") &&
        original.type === "git" &&
        (original.url === "file:./viberoots" || original.url === "file:../../viberoots"))
    ) {
      return;
    }
    if (
      locked.type === "path" &&
      expectedViberootsPaths.has(resolveLockPath(locked.path)) &&
      original.type === "path" &&
      expectedViberootsPaths.has(resolveLockPath(original.path))
    ) {
      return;
    }
  } catch {
    throw new Error("[startup-check] workspace flake.lock is missing or invalid");
  }
  throw new Error("[startup-check] workspace flake.lock is not aligned with local viberoots input");
}

async function requireLocalCurrentTarget(flakeText: string): Promise<void> {
  if (!flakeUsesSubmoduleViberoots(flakeText)) return;
  try {
    await fsp.lstat(".viberoots/current");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const expectedReal = await fsp.realpath("viberoots");
  let currentReal = "";
  try {
    currentReal = await fsp.realpath(".viberoots/current");
  } catch {
    const target = await fsp.readlink(".viberoots/current");
    throw new Error(
      `[startup-check] .viberoots/current points at ${target}; expected ${expectedReal}`,
    );
  }
  if (currentReal !== expectedReal) {
    throw new Error(
      `[startup-check] .viberoots/current points at ${currentReal}; expected ${expectedReal}`,
    );
  }
}

async function expectedGitlinkRevision(): Promise<string> {
  const entry = await git(["ls-files", "-s", "viberoots"]);
  const match = entry.match(/^160000\s+([0-9a-f]{40})\s+/);
  return match?.[1] || "";
}

function strictSubmoduleState(): boolean {
  return (
    (process.env.VIBEROOTS_STRICT_SUBMODULE_STATE || "").trim() === "1" ||
    (process.env.CI || "").trim() === "true" ||
    (process.env.CI || "").trim() === "1"
  );
}

function warnOrThrowSubmoduleState(message: string): void {
  if (strictSubmoduleState()) throw new Error(message);
  if (isVbrVerbose()) console.warn(message);
  else createCommandUi({ verbose: false }).warn(message.replace(/^\[startup-check\]\s*/, ""));
}

async function requireSubmoduleGitState(flakeText: string): Promise<void> {
  if (!flakeUsesSubmoduleViberoots(flakeText)) return;
  if (!(await exists("viberoots/.git")) && !(await exists(".git/modules/viberoots"))) return;
  const expected = await expectedGitlinkRevision();
  if (!expected) {
    warnOrThrowSubmoduleState(
      "[startup-check] viberoots is not recorded as a git submodule gitlink",
    );
    return;
  }
  const actual = await git(["rev-parse", "HEAD"], "viberoots");
  if (!actual) {
    throw new Error(
      "[startup-check] viberoots submodule is uninitialized; run `git submodule update --init viberoots`",
    );
  }
  if (actual !== expected) {
    warnOrThrowSubmoduleState(
      `[startup-check] viberoots submodule revision ${actual} does not match parent gitlink ${expected}`,
    );
  }
  const dirty = await git(["status", "--porcelain=v1"], "viberoots");
  if (dirty) {
    warnOrThrowSubmoduleState("[startup-check] viberoots submodule has uncommitted changes");
  }
}

async function requireBuckconfigCells(buckconfig: string): Promise<void> {
  const values = buckconfig
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes(".viberoots/current"))
    .map((line) => line.split("=", 2)[1]?.trim() || "")
    .filter(Boolean);
  for (const value of values) {
    if (!(await exists(path.resolve(value)))) {
      throw new Error(`[startup-check] .buckconfig references missing cell path: ${value}`);
    }
  }
}

async function requirePreludeEntrypoint(): Promise<void> {
  const hiddenRel = ".viberoots/current/prelude/prelude.bzl";
  if (await exists(hiddenRel)) return;
  throw new Error(
    `[startup-check] invalid Buck prelude: ${hiddenRel} is missing. Re-enter the dev shell or run \`viberoots init-workspace\`.`,
  );
}

async function cleanupVerifyOwnedRootBuckOut(): Promise<void> {
  const buckOut = "buck-out";
  const broadCleanup = process.env.VBR_STARTUP_BROAD_BUCK_OUT_CLEANUP === "1";
  const entries = await fsp.readdir(buckOut, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith("v-") || name.startsWith("verify-nested-")) {
      const ownerPid = (name.match(/^v-(\d+)-/) || name.match(/^verify-nested-(\d+)-/))?.[1] || "";
      if (!ownerPid) {
        if (!broadCleanup) continue;
      } else {
        try {
          process.kill(Number(ownerPid), 0);
          continue;
        } catch {}
      }
      await execFileAsync("buck2", ["--isolation-dir", name, "kill"]).catch(() => {});
    } else if (
      name === "test-logs" ||
      name === "tmp" ||
      name === "zx_shims" ||
      name === "v2" ||
      name.startsWith("deployment-query-") ||
      name.startsWith("zxtest-shared-") ||
      name.startsWith("exporter-shared-")
    ) {
      if (!broadCleanup) continue;
      if (name === "v2") {
        await execFileAsync("buck2", ["kill"]).catch(() => {});
      } else if (
        name.startsWith("deployment-query-") ||
        name.startsWith("zxtest-shared-") ||
        name.startsWith("exporter-shared-")
      ) {
        await execFileAsync("buck2", ["--isolation-dir", name, "kill"]).catch(() => {});
      }
    } else {
      continue;
    }
    await fsp.rm(path.join(buckOut, name), { recursive: true, force: true }).catch(() => {});
  }
  await fsp.rmdir(buckOut).catch(() => {});
}

export async function validateStartupWorkspaceState(): Promise<void> {
  await requireBuckroot();
  const flakeText = await readWorkspaceFlakeText();
  await requireLocalViberootsFlake(flakeText);
  await requireLocalCurrentTarget(flakeText);

  const buckconfig = await readText(".buckconfig");
  if (!buckconfig) {
    throw new Error(
      "[startup-check] .buckconfig not found; run 'nix develop' to generate it. Exporter will fail without a valid prelude mapping.",
    );
  }
  const hasPrelude = /\[repositories\][\s\S]*?^\s*prelude\s*=\s*/m.test(buckconfig);
  const hasCellsPrelude = /\[cells\][\s\S]*?^\s*prelude\s*=\s*/m.test(buckconfig);
  if (!hasPrelude || !hasCellsPrelude) {
    throw new Error(
      "[startup-check] invalid .buckconfig: missing prelude mapping in [repositories] or [cells]. Run 'nix develop' to provision or fix the mapping.",
    );
  }
  await requirePreludeEntrypoint();
  await requireBuckconfigCells(buckconfig);
  await requireLocalFlakeLock(flakeText);
  await requireSubmoduleGitState(flakeText);
  await cleanupVerifyOwnedRootBuckOut();
  const blockers = findExtractionBlockers(process.cwd());
  if (blockers.length === 0) return;
  const message = `[startup-check] extraction old-layout blockers remain:\n${formatExtractionBlockers(blockers)}`;
  if ((process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS || "").trim() === "1") {
    throw new Error(message);
  }
  console.warn(message);
}
