import type { RepoInitMode } from "../seed-store";
import { timeAsync } from "../timing";
import { gitStageRelPaths, uniqueRelPaths } from "./flake-rewrite";

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
      const relPaths = uniqueRelPaths(seedTouchedRelPaths);
      if (relPaths.length === 0) return;
      await timeAsync(
        "runInTemp gitBootstrap stageOverlay",
        async () => await gitStageRelPaths($tmp, tmp, relPaths),
      );
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
