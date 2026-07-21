import path from "node:path";
import { runManagedCommand } from "../lib/managed-command";
import { buckIsolationProcessPidsFromLines } from "../lib/buck-isolation-processes";
import { buckProcessTableLines } from "../lib/process-inspection";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import {
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../lib/artifact-environment";
import {
  changedGraphConsumerIsolationNames,
  sharedDevBuildIsolationName,
} from "./dev-build/isolation";

const shutdownTimeoutMs = 30_000;
const exitTimeoutMs = 5_000;

function isolationProcessLines(
  lines: readonly string[],
  workspaceRoot: string,
  isolation: string,
): string[] {
  const pids = new Set(
    buckIsolationProcessPidsFromLines({ root: workspaceRoot, iso: isolation, lines: [...lines] }),
  );
  return lines.filter((line) => {
    const pid = Number(line.match(/^(\d+)\s/)?.[1] || "");
    return Number.isFinite(pid) && pids.has(pid);
  });
}

async function completeIsolationShutdown(workspaceRoot: string, isolation: string): Promise<void> {
  const lines = await buckProcessTableLines(2_000);
  const pids = buckIsolationProcessPidsFromLines({
    root: workspaceRoot,
    iso: isolation,
    lines,
  });
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  if (pids.length > 0) {
    console.log(
      `[buck-global-input-handoff] isolation=${isolation} exact_processes_terminated=${pids.length}`,
    );
  }
}

async function waitForIsolationExit(workspaceRoot: string, isolation: string): Promise<void> {
  const deadline = Date.now() + exitTimeoutMs;
  let remaining: string[] = [];
  do {
    remaining = isolationProcessLines(await buckProcessTableLines(2_000), workspaceRoot, isolation);
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(
    `Buck isolation did not exit after global-input reconciliation: ${isolation}\n${remaining.join("\n")}`,
  );
}

export async function handoffChangedGlobalInputConsumers(
  workspaceRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const stateRoot = path.join(workspaceRoot, "buck-out", "tmp", "artifact-environment");
  const artifactEnv = buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(baseEnv),
    mode: String(baseEnv.CI || "").trim() ? "ci" : "local",
    stateRoot,
    workspaceRoot,
    internal: {
      BUCK2_REAL_HOME: path.join(stateRoot, "home"),
      BUCK_ROOT: workspaceRoot,
      WORKSPACE_ROOT: workspaceRoot,
    },
  });
  const callerEnv = {
    ...baseEnv,
    HOME: baseEnv.BUCK2_REAL_HOME || baseEnv.HOME,
    SSL_CERT_FILE: baseEnv.SSL_CERT_FILE || baseEnv.NIX_SSL_CERT_FILE,
  };
  const isolated = String(baseEnv.BUCK_NO_ISOLATION || "").trim() !== "1";
  const isolationNames = changedGraphConsumerIsolationNames(workspaceRoot, baseEnv);
  const requests = isolated
    ? isolationNames.map((name) => ({ name, args: ["--isolation-dir", name] }))
    : [{ name: "", args: [] }];
  for (const request of requests) {
    const env =
      request.name === sharedDevBuildIsolationName(workspaceRoot) ? artifactEnv : callerEnv;
    const buck2 = ensureNixStoreToolPathSync("buck2", env);
    const result = await runManagedCommand({
      command: buck2,
      args: [...request.args, "kill"],
      cwd: workspaceRoot,
      env,
      timeoutMs: shutdownTimeoutMs,
    });
    if (!result.ok) {
      throw new Error(
        `failed to stop Buck after global-input reconciliation: ${String(result.stderr || result.stdout).trim()}`,
      );
    }
    if (request.name) {
      await completeIsolationShutdown(workspaceRoot, request.name);
      await waitForIsolationExit(workspaceRoot, request.name);
    }
  }
}
