import path from "node:path";
import "zx/globals";

export type Isolation = {
  buckIsolation: string;
  isolationFlags: string[];
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
  const inheritedIso = (process.env.BUCK_ISOLATION_DIR || "").trim();
  const buckIsolation = inheritedIso ? inheritedIso : `devbuild-${process.pid}`;
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
          try {
            await $`buck2 --isolation-dir ${buckIsolation} kill`;
          } catch {}
          await reapExporterDaemonsFromPs();
          process.exit(130);
        });
      } catch {}
    }
  }

  function attachExitHandlers() {
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
      const nodeBase = [
        "--experimental-top-level-await",
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--import",
        path.resolve(repoRoot, "tools/dev/zx-init.mjs"),
      ].join(" ");
      const node = process.execPath || "node";
      await $({
        stdio: "ignore",
      })`bash --noprofile --norc -c ${`${node} ${nodeBase} ${path.join(
        repoRoot,
        "tools/dev/buck-watchdog.ts",
      )} --parent ${parentPid} --iso ${buckIsolation} --patterns zxtest-,exporter-,devbuild- & disown`}`.nothrow();
    } catch {}
  }

  return {
    buckIsolation,
    isolationFlags,
    killIsolationIfOwned,
    attachSignalHandlers,
    attachExitHandlers,
    startWatchdog,
  };
}
