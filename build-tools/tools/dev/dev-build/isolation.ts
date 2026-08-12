import path from "node:path";
import crypto from "node:crypto";
import { nodeFlagsWithZx } from "../../lib/node-run";
import { buckProcessTableLines } from "../../lib/process-inspection";
import { macosNoindexPathSegment } from "../../lib/macos-metadata";
import { artifactBuckIsolation } from "./cache-isolation";
import { buildToolPath, zxInitPath } from "./paths";

export type Isolation = {
  baseBuckIsolation: string;
  buckIsolation: string;
  cachePolicyBinding: string;
  isolationFlags: string[];
  reuseDaemon: boolean;
  killOnExit: boolean;
  registerForCleanup: boolean;
  killIsolationIfOwned: () => Promise<void>;
  attachSignalHandlers: () => void;
  attachExitHandlers: () => void;
  startWatchdog: (repoRoot: string) => Promise<void>;
};

export type CreateIsolationOptions = {
  cachePolicyBinding?: string;
  reuseDaemon?: boolean;
};

function sharedIsolationHash(workspaceRoot: string): string {
  return crypto.createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 10);
}

export function legacyDarwinSharedIsolationNames(
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== "darwin") return [];
  const repoHash = sharedIsolationHash(workspaceRoot);
  return [`devbuild-shared-${repoHash}`, `exporter-shared-${repoHash}`];
}

export function sharedDevBuildIsolationName(
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const repoHash = sharedIsolationHash(workspaceRoot);
  return macosNoindexPathSegment(`devbuild-shared-${repoHash}`, platform);
}

export function sharedExporterIsolationName(
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const repoHash = sharedIsolationHash(workspaceRoot);
  return macosNoindexPathSegment(`exporter-shared-${repoHash}`, platform);
}

export function changedGraphConsumerIsolationNames(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    ...new Set(
      [
        sharedDevBuildIsolationName(workspaceRoot),
        sharedExporterIsolationName(workspaceRoot),
        ...legacyDarwinSharedIsolationNames(workspaceRoot),
        String(env.BUCK_ISOLATION_DIR || "").trim(),
        String(env.BUCK_NESTED_ISO || "").trim(),
      ].filter(Boolean),
    ),
  ];
}

async function reapChildBuckDaemonsByPrefix(prefixes: string[]): Promise<void> {
  try {
    const lines = await buckProcessTableLines(2000);
    for (const ln of lines) {
      const m = ln.match(/buck2d\[([^\]]+)\]/);
      if (!m) continue;
      const iso = m[1] || "";
      if (prefixes.some((p) => iso.startsWith(p))) {
        try {
          await $`buck2 --isolation-dir ${iso} kill`;
        } catch {}
      }
    }
  } catch {}
}

async function reapExporterDaemonsFromPs(): Promise<void> {
  try {
    const lines = await buckProcessTableLines(2000);
    for (const ln of lines) {
      const m = ln.match(/--isolation-dir\s+(exporter-[^\s]+)/);
      if (!m) continue;
      try {
        await $`buck2 --isolation-dir ${m[1]} kill`;
      } catch {}
    }
  } catch {}
}

export function createIsolation(opts: CreateIsolationOptions = {}): Isolation {
  const reuseDaemon =
    opts.reuseDaemon ?? String(process.env.BUCK_DEVBUILD_REUSE_DAEMON || "1").trim() !== "0";
  const defaultKillOnExit = !reuseDaemon;
  const killOnExit = String(process.env.BUCK_DEVBUILD_KILL_ON_EXIT || "").trim()
    ? String(process.env.BUCK_DEVBUILD_KILL_ON_EXIT || "").trim() === "1"
    : defaultKillOnExit;
  const inheritedIso = (process.env.BUCK_ISOLATION_DIR || "").trim();
  const defaultIso = reuseDaemon
    ? sharedDevBuildIsolationName(process.cwd())
    : macosNoindexPathSegment(`devbuild-${process.pid}`);
  const baseBuckIsolation = inheritedIso ? inheritedIso : defaultIso;
  const cachePolicyBinding = String(opts.cachePolicyBinding || "").trim();
  const buckIsolation = cachePolicyBinding
    ? artifactBuckIsolation(baseBuckIsolation, cachePolicyBinding)
    : baseBuckIsolation;
  const createdOwnIsolation = !inheritedIso && process.env.BUCK_NO_ISOLATION !== "1";
  const registerForCleanup = createdOwnIsolation && killOnExit;
  const isolationFlags: string[] =
    process.env.BUCK_NO_ISOLATION === "1" ? [] : ["--isolation-dir", buckIsolation];
  async function killIsolationIfOwned() {
    if (!createdOwnIsolation || !killOnExit) return;
    try {
      await $`buck2 --isolation-dir ${buckIsolation} kill`;
    } catch {}
    await reapChildBuckDaemonsByPrefix(["zxtest-", "exporter-"]);
  }

  function attachSignalHandlers() {
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      try {
        process.on(sig as any, async () => {
          try {
            process.kill(-process.pid, sig as any);
          } catch {}
          if (killOnExit) {
            try {
              await $`buck2 --isolation-dir ${buckIsolation} kill`;
            } catch {}
          }
          await reapExporterDaemonsFromPs();
          process.exit(130);
        });
      } catch {}
    }
  }

  function attachExitHandlers() {
    if (!killOnExit) return;
    process.once("exit", () => {
      (async () => {
        try {
          await $`buck2 --isolation-dir ${buckIsolation} kill`;
        } catch {}
        await reapExporterDaemonsFromPs();
      })();
    });
  }

  async function startWatchdog(repoRoot: string): Promise<void> {
    try {
      const parentPid = String(process.pid);
      const nodeBase = nodeFlagsWithZx(zxInitPath(repoRoot)).join(" ");
      const node = process.execPath || "node";
      const watchdogIso = killOnExit ? `--iso ${buckIsolation}` : "";
      const watchdogPatterns = killOnExit ? "zxtest-,exporter-,devbuild-" : "zxtest-,exporter-";
      await $({
        stdio: "ignore",
      })`bash --noprofile --norc -c ${`${node} ${nodeBase} ${path.join(
        buildToolPath(repoRoot, "tools/dev/buck-watchdog.ts"),
      )} --parent ${parentPid} ${watchdogIso} --patterns ${watchdogPatterns} & disown`}`.nothrow();
    } catch {}
  }

  return {
    baseBuckIsolation,
    buckIsolation,
    cachePolicyBinding,
    isolationFlags,
    reuseDaemon,
    killOnExit,
    registerForCleanup,
    killIsolationIfOwned,
    attachSignalHandlers,
    attachExitHandlers,
    startWatchdog,
  };
}
