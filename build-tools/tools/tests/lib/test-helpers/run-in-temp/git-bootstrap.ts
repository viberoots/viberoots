import * as fsp from "node:fs/promises";
import path from "node:path";
import type { RepoInitMode } from "../seed-store";
import { timeAsync } from "../timing";
import { gitStageRelPaths, uniqueRelPaths } from "./flake-rewrite";

async function ensureNestedViberootsCommit(
  tmp: string,
  opts: { stageAll: boolean; touchedRelPaths: string[] },
): Promise<{ changed: boolean; head: string } | null> {
  const nested = path.join(tmp, "viberoots");
  const hasSource = await fsp
    .access(path.join(nested, "build-tools", "tools", "dev", "zx-init.mjs"))
    .then(() => true)
    .catch(() => false);
  if (!hasSource) return null;
  const git = $({
    cwd: nested,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "1970-01-01T00:00:00Z",
    },
  });
  const inside = await git`git rev-parse --is-inside-work-tree`.nothrow().quiet();
  const nestedTop =
    String(inside.stdout || "").trim() === "true"
      ? String((await git`git rev-parse --show-toplevel`).stdout || "").trim()
      : "";
  const hasNestedRepo = inside.exitCode === 0 && path.resolve(nestedTop) === path.resolve(nested);
  if (!hasNestedRepo && !opts.stageAll) {
    throw new Error("prepared seed is missing its nested viberoots Git repository");
  }
  if (!hasNestedRepo) {
    await fsp.rm(path.join(nested, ".git"), { recursive: true, force: true });
    await git`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`;
    await git`git config gc.auto 0`;
  }
  const previousHead = await git`git rev-parse --verify HEAD`.nothrow().quiet();
  if (!opts.stageAll && opts.touchedRelPaths.length === 0) {
    const head = String(previousHead.stdout || "").trim();
    if (previousHead.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(head)) {
      throw new Error("prepared seed has no valid nested viberoots HEAD");
    }
    return { changed: false, head };
  }
  if (opts.stageAll) await git`git add -A`;
  else await gitStageRelPaths(git, nested, opts.touchedRelPaths);
  const changed = await git`git diff --cached --quiet --exit-code`.nothrow().quiet();
  if (previousHead.exitCode !== 0 || changed.exitCode === 1) {
    await git`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-viberoots --allow-empty`;
  } else if (changed.exitCode !== 0) {
    throw new Error(String(changed.stderr || "nested viberoots staged diff failed"));
  }
  const head = String((await git`git rev-parse HEAD`).stdout || "").trim();
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error(`nested viberoots HEAD is invalid: ${head}`);
  }
  return { changed: head !== String(previousHead.stdout || "").trim(), head };
}

export async function bootstrapTempGit(args: {
  initMode: RepoInitMode;
  seedTouchedRelPaths: string[];
  tempSetupEnv: Record<string, string>;
  tmp: string;
}): Promise<void> {
  const { initMode, seedTouchedRelPaths, tempSetupEnv, tmp } = args;
  const $tmp = $({ cwd: tmp, stdio: "pipe", env: tempSetupEnv });
  await timeAsync("runInTemp gitBootstrap", async () => {
    try {
      const relPaths = uniqueRelPaths(seedTouchedRelPaths);
      const nestedRelPaths = relPaths
        .filter((rel) => rel.startsWith("viberoots/"))
        .map((rel) => rel.slice("viberoots/".length));
      const nested = await timeAsync(
        "runInTemp gitBootstrap nestedViberoots",
        async () =>
          await ensureNestedViberootsCommit(tmp, {
            stageAll: initMode === "rsync",
            touchedRelPaths: nestedRelPaths,
          }),
      );
      if (initMode === "rsync") {
        await timeAsync(
          "runInTemp gitBootstrap init",
          async () =>
            await $tmp`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`,
        );
        await timeAsync("runInTemp gitBootstrap addAll", async () => await $tmp`git add -A`);
        await timeAsync(
          "runInTemp gitBootstrap commit",
          async () =>
            await $tmp`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m init --allow-empty`
              .nothrow()
              .quiet(),
        );
        return;
      }
      const ok = await timeAsync(
        "runInTemp gitBootstrap revParseInside",
        async () => await $tmp`git rev-parse --is-inside-work-tree`.nothrow().quiet(),
      );
      if (String(ok.stdout || "").trim() !== "true") {
        throw new Error(
          `runInTemp: expected seeded temp repo to be a git worktree (mode=${initMode})`,
        );
      }
      const head = await timeAsync(
        "runInTemp gitBootstrap revParseHead",
        async () => await $tmp`git rev-parse HEAD`.nothrow().quiet(),
      );
      if (head.exitCode !== 0) {
        throw new Error(
          `runInTemp: expected seeded temp repo to have an initial commit (mode=${initMode})`,
        );
      }
      const parentRelPaths = relPaths.filter(
        (rel) => rel !== "viberoots" && !rel.startsWith("viberoots/"),
      );
      if (parentRelPaths.length > 0) {
        await timeAsync(
          "runInTemp gitBootstrap stageOverlay",
          async () => await gitStageRelPaths($tmp, tmp, parentRelPaths),
        );
      }
      const nestedOverlay = relPaths.some(
        (rel) => rel === "viberoots" || rel.startsWith("viberoots/"),
      );
      if (nested?.changed || nestedOverlay) {
        await $tmp`git add -- viberoots`;
      } else if (nested) {
        const gitlink = String((await $tmp`git ls-files -s -- viberoots`).stdout || "").trim();
        const expected = `160000 ${nested.head} 0\tviberoots`;
        if (gitlink !== expected) {
          throw new Error(`prepared seed gitlink mismatch: ${gitlink}; expected ${expected}`);
        }
      }
      const diff = await timeAsync(
        "runInTemp gitBootstrap stagedDiff",
        async () => await $tmp`git diff --cached --quiet --exit-code`.nothrow().quiet(),
      );
      if (diff.exitCode === 1) {
        await timeAsync(
          "runInTemp gitBootstrap commit",
          async () =>
            await $tmp`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-overlay --allow-empty`
              .nothrow()
              .quiet(),
        );
      } else if (diff.exitCode !== 0) {
        throw new Error(String(diff.stderr || "git diff --cached failed"));
      }
    } catch {
      throw new Error("runInTemp: git is required for deterministic temp-repo nix builds");
    }
  });
}

export async function commitTempFlakeRewrite(args: {
  tempSetupEnv: Record<string, string>;
  tmp: string;
  touched: string[];
}): Promise<void> {
  if (args.touched.length === 0) return;
  const $tmp = $({ cwd: args.tmp, stdio: "pipe", env: args.tempSetupEnv });
  await gitStageRelPaths($tmp, args.tmp, args.touched);
  const diff = await $tmp`git diff --cached --quiet --exit-code`.nothrow().quiet();
  if (diff.exitCode === 1) {
    await $tmp`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-overlay-flake --allow-empty`
      .nothrow()
      .quiet();
  } else if (diff.exitCode !== 0) {
    throw new Error(String(diff.stderr || "git diff --cached failed"));
  }
}
