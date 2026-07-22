import { AsyncLocalStorage } from "node:async_hooks";
import { runManagedCommand, type ManagedCommandActivity } from "./managed-command";

export type ArtifactCommandLifecycleSummary = {
  managedCommandCount: number;
  closedProcessGroupCount: number;
  survivingProcessGroupCount: 0;
  processGroups: Array<{
    leaderPid: number;
    processGroupId: number;
    descendantInspection: "verified";
    observedDescendantPids: number[];
    descendantsClosed: true;
  }>;
};

export type ArtifactCommandLifecycleRecorder = {
  started(processGroupId: number): void;
  closed(processGroupId: number): Promise<void>;
};

const lifecycleScope = new AsyncLocalStorage<ArtifactCommandLifecycleRecorder>();

export async function withArtifactCommandLifecycle<T>(
  recorder: ArtifactCommandLifecycleRecorder,
  operation: () => Promise<T>,
): Promise<T> {
  return await lifecycleScope.run(recorder, operation);
}

export type ArtifactCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  interrupted: boolean;
  childPid: number;
};

function positiveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const normalized = String(value || "").trim();
  if (!normalized) return fallbackMs;
  const seconds = Number(normalized);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`invalid VBR_ARTIFACT_COMMAND_TIMEOUT_SECS '${normalized}'`);
  }
  return Math.ceil(seconds * 1000);
}

export async function runBoundedArtifactCommand(opts: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}): Promise<ArtifactCommandResult> {
  const timeoutMs =
    opts.timeoutMs ?? positiveTimeoutMs(opts.env.VBR_ARTIFACT_COMMAND_TIMEOUT_SECS, 600_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`artifact command requires a positive timeout: ${timeoutMs}`);
  }
  const activity: ManagedCommandActivity = {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  const recorder = lifecycleScope.getStore();
  const command = runManagedCommand({
    command: opts.command,
    args: opts.args,
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs,
    killGraceMs: 5_000,
    onStdout: opts.onStdout,
    onStderr: opts.onStderr,
    activity,
  });
  if (activity.childPid && activity.childPid > 0) {
    recorder?.started(activity.childPid);
  }
  const result = await command.finally(async () => {
    if (activity.childPid && activity.childPid > 0) {
      await recorder?.closed(activity.childPid);
    }
  });
  return {
    exitCode: result.code ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    interrupted: result.interrupted,
    childPid: activity.childPid ?? -1,
  };
}

export function assertArtifactCommandSucceeded(
  command: string,
  result: ArtifactCommandResult,
): void {
  if (result.exitCode === 0 && !result.timedOut && !result.interrupted) return;
  const reason = result.timedOut
    ? "timed out after terminating descendants"
    : result.interrupted
      ? "was interrupted after terminating descendants"
      : `exited ${result.exitCode}`;
  throw new Error(
    `artifact command ${command} ${reason}${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}`,
  );
}
