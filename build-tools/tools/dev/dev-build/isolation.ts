import path from "node:path";
import crypto from "node:crypto";
import "zx/globals";
import { nodeFlagsWithZx } from "../../lib/node-run.ts";

export type Isolation = {
  buckIsolation: string;
  isolationFlags: string[];
  reuseDaemon: boolean;
  killOnExit: boolean;
  killIsolationIfOwned: () => Promise<void>;
  attachSignalHandlers: () => void;
  attachExitHandlers: () => void;
  startWatchdog: (repoRoot: string) => Promise<void>;
};

async function reapChildBuckDaemonsByPrefix(prefixes: string[]): Promise<void> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`/bin/ps -A -o pid=,comm=`;
    const lines = String(stdout || "").split("\n");
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
    const { stdout } = await $({ stdio: "pipe" })`/bin/ps -A -o pid=,command=`;
    const lines = String(stdout || "").split("\n");
    for (const ln of lines) {
      const m = ln.match(/--isolation-dir\s+(exporter-[^\s]+)/);
      if (!m) continue;
      try {
        await $`buck2 --isolation-dir ${m[1]} kill`;
      } catch {}
    }
  } catch {}
}

export function createIsolation(): Isolation {
  const reuseDaemon = String(process.env.BUCK_DEVBUILD_REUSE_DAEMON || "1").trim() !== "0";
  const defaultKillOnExit = !reuseDaemon;
  const killOnExit = String(process.env.BUCK_DEVBUILD_KILL_ON_EXIT || "").trim()
    ? String(process.env.BUCK_DEVBUILD_KILL_ON_EXIT || "").trim() === "1"
    : defaultKillOnExit;
  const inheritedIso = (process.env.BUCK_ISOLATION_DIR || "").trim();
  const repoHash = crypto
    .createHash("sha256")
    .update(path.resolve(process.cwd()))
    .digest("hex")
    .slice(0, 10);
  const defaultIso = reuseDaemon ? `devbuild-shared-${repoHash}` : `devbuild-${process.pid}`;
  const buckIsolation = inheritedIso ? inheritedIso : defaultIso;
  const createdOwnIsolation = !inheritedIso && process.env.BUCK_NO_ISOLATION !== "1";
  const isolationFlags: string[] =
    process.env.BUCK_NO_ISOLATION === "1" ? [] : ["--isolation-dir", buckIsolation];

  async function killIsolationIfOwned() {
    if (!createdOwnIsolation) return;
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
      const nodeBase = nodeFlagsWithZx(
        path.resolve(repoRoot, "build-tools/tools/dev/zx-init.mjs"),
      ).join(" ");
      const node = process.execPath || "node";
      const watchdogIso = killOnExit ? `--iso ${buckIsolation}` : "";
      const watchdogPatterns = killOnExit ? "zxtest-,exporter-,devbuild-" : "zxtest-,exporter-";
      await $({
        stdio: "ignore",
      })`bash --noprofile --norc -c ${`${node} ${nodeBase} ${path.join(
        repoRoot,
        "build-tools/tools/dev/buck-watchdog.ts",
      )} --parent ${parentPid} ${watchdogIso} --patterns ${watchdogPatterns} & disown`}`.nothrow();
    } catch {}
  }

  return {
    buckIsolation,
    isolationFlags,
    reuseDaemon,
    killOnExit,
    killIsolationIfOwned,
    attachSignalHandlers,
    attachExitHandlers,
    startWatchdog,
  };
}
