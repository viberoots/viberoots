import path from "node:path";
import type { SeededTempSetup } from "./contracts";
import { prepareFilteredConsumerSnapshot, workspaceFlakeRef } from "./filtered-inputs";
import { exportDevEnvWithRetry, retryTransientNixStoreFailure } from "./nix-support";
import { timeAsync } from "../timing";

type ConsumerSnapshot = Awaited<ReturnType<typeof prepareFilteredConsumerSnapshot>>;

export async function prepareOptionalDevEnv(setup: SeededTempSetup): Promise<{
  consumerSnapshot: ConsumerSnapshot | null;
  envOut: { stdout: string };
}> {
  if ((process.env.TEST_NEED_DEV_ENV || "") !== "1") {
    return { consumerSnapshot: null, envOut: { stdout: "" } };
  }
  const { tempSetupEnv, tmp, viberootsInput, viberootsSourceRoot } = setup;
  const consumerSnapshot = await timeAsync("runInTemp prepareFilteredConsumerSnapshot", async () =>
    prepareFilteredConsumerSnapshot(tmp),
  );
  const flakeRef = await workspaceFlakeRef(consumerSnapshot.root);
  const snapshotEnv = {
    ...tempSetupEnv,
    WORKSPACE_ROOT: consumerSnapshot.root,
    BUCK_TEST_SRC: consumerSnapshot.root,
    VBR_FILTERED_FLAKE_SNAPSHOT: "1",
    VBR_PNPM_FILTERED_SNAPSHOT_ROOT: consumerSnapshot.root,
  };
  const $snapshot = $({ cwd: consumerSnapshot.root, env: snapshotEnv, stdio: "pipe" });
  const chk = await retryTransientNixStoreFailure(
    "checking temp repo buck2-prelude",
    async () =>
      await $snapshot`nix build ${`path:${flakeRef}#buck2-prelude`} --no-link --no-write-lock-file --accept-flake-config --print-build-logs`.nothrow(),
    (out) => `${(out as any).stdout || ""}\n${(out as any).stderr || ""}`,
    (out) => Number((out as any).exitCode || 0) !== 0,
  );
  if (chk.exitCode !== 0) {
    const detail = `${String(chk.stdout || "")}\n${String(chk.stderr || "")}`.trim();
    throw new Error(
      [
        "dev-shell check failed: nix build path:<filtered-temp>#buck2-prelude did not succeed; ensure direnv/dev shell is active",
        detail,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const stdout = await timeAsync(
    `devEnvExport(${path.basename(tmp)})`,
    async () =>
      await exportDevEnvWithRetry($, {
        commandSourceRoot: viberootsSourceRoot,
        consumerSnapshotRoot: consumerSnapshot.root,
        flakeInput: viberootsInput,
      }),
  );
  return { consumerSnapshot, envOut: { stdout } };
}
