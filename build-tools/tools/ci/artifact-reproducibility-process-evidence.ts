import { spawnSync } from "node:child_process";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import type {
  ArtifactCommandLifecycleRecorder,
  ArtifactCommandLifecycleSummary,
} from "../lib/artifact-command-runner";

type InspectGroup = (processGroupId: number) => boolean;
type ProcessRow = { pid: number; parentPid: number; processGroupId: number };
type InspectProcesses = () => ProcessRow[];
type LifecycleOptions = { inspectGroup?: InspectGroup } & (
  | { env: NodeJS.ProcessEnv; inspectProcesses?: never }
  | { env?: never; inspectProcesses: InspectProcesses }
);
type GroupRecord = {
  processGroupId: number;
  closed: boolean;
  observedDescendantPids: Set<number>;
  escapedPid?: number;
  inspectionError?: Error;
  timer?: ReturnType<typeof setInterval>;
};

function processGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function storeProcessInspector(
  env: NodeJS.ProcessEnv,
  deps: {
    resolve?: (tool: string, env: NodeJS.ProcessEnv) => string;
    run?: (executable: string, args: string[], env: NodeJS.ProcessEnv) => string;
  } = {},
): InspectProcesses {
  const executable = (deps.resolve || ensureNixStoreToolPathSync)("ps", env);
  return () => {
    const childEnv = { ...env, LC_ALL: "C.UTF-8" };
    const stdout = deps.run
      ? deps.run(executable, ["-axo", "pid=,ppid=,pgid="], childEnv)
      : runStoreProcessInspection(executable, childEnv);
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const values = line.trim().split(/\s+/u).map(Number);
        if (values.length !== 3 || values.some((value) => !Number.isSafeInteger(value))) {
          throw new Error(`store-qualified process inspection returned an invalid row: ${line}`);
        }
        return { pid: values[0], parentPid: values[1], processGroupId: values[2] };
      });
  };
}

function runStoreProcessInspection(executable: string, env: NodeJS.ProcessEnv): string {
  const result = spawnSync(executable, ["-axo", "pid=,ppid=,pgid="], {
    encoding: "utf8",
    env,
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`store-qualified process inspection failed: ${result.error || result.stderr}`);
  }
  return result.stdout;
}

export class ArtifactProcessLifecycle implements ArtifactCommandLifecycleRecorder {
  readonly #groups: GroupRecord[] = [];
  readonly #inspect: InspectGroup;
  readonly #inspectProcesses: InspectProcesses;

  constructor(options: LifecycleOptions) {
    this.#inspect = options.inspectGroup || processGroupAlive;
    this.#inspectProcesses = options.inspectProcesses
      ? options.inspectProcesses
      : storeProcessInspector(options.env);
  }

  started(processGroupId: number): void {
    if (!Number.isInteger(processGroupId) || processGroupId <= 1) {
      throw new Error("managed artifact command reported an invalid process group");
    }
    const record: GroupRecord = {
      processGroupId,
      closed: false,
      observedDescendantPids: new Set(),
    };
    this.#groups.push(record);
    this.#sample(record);
    record.timer = setInterval(() => this.#sample(record), 20);
    record.timer.unref();
  }

  async closed(processGroupId: number): Promise<void> {
    const record = this.#groups.findLast(
      (entry) => entry.processGroupId === processGroupId && !entry.closed,
    );
    if (!record)
      throw new Error(`managed artifact process group was not recorded: ${processGroupId}`);
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        this.#sample(record);
        const rows = this.#inspectProcesses();
        const observedAlive = rows.some(({ pid }) => record.observedDescendantPids.has(pid));
        if (!this.#inspect(processGroupId) && !observedAlive) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      if (record.timer) clearInterval(record.timer);
    }
    if (record.inspectionError) throw record.inspectionError;
    if (record.escapedPid) {
      throw new Error(
        `managed artifact descendant ${record.escapedPid} escaped process group ${processGroupId}`,
      );
    }
    const rows = this.#inspectProcesses();
    if (
      this.#inspect(processGroupId) ||
      rows.some(({ pid }) => record.observedDescendantPids.has(pid))
    ) {
      throw new Error(`managed artifact command left process group ${processGroupId} alive`);
    }
    record.closed = true;
  }

  #sample(record: GroupRecord): void {
    if (record.inspectionError) return;
    try {
      const rows = this.#inspectProcesses();
      const lineage = new Set([record.processGroupId, ...record.observedDescendantPids]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const row of rows) {
          if (
            row.pid !== record.processGroupId &&
            lineage.has(row.parentPid) &&
            !lineage.has(row.pid)
          ) {
            lineage.add(row.pid);
            record.observedDescendantPids.add(row.pid);
            changed = true;
          }
        }
      }
      for (const row of rows) {
        if (
          (row.pid === record.processGroupId || record.observedDescendantPids.has(row.pid)) &&
          row.processGroupId !== record.processGroupId
        ) {
          record.escapedPid = row.pid;
        }
      }
    } catch (error) {
      record.inspectionError = error as Error;
    }
  }

  assertComplete(): ArtifactCommandLifecycleSummary {
    const survivors = this.#groups.filter((group) => this.#inspect(group.processGroupId));
    const closedCount = this.#groups.filter(({ closed }) => closed).length;
    if (survivors.length || closedCount !== this.#groups.length) {
      throw new Error("artifact cell has surviving or unclosed managed process groups");
    }
    return {
      managedCommandCount: this.#groups.length,
      closedProcessGroupCount: closedCount,
      survivingProcessGroupCount: 0,
      processGroups: this.#groups.map(({ processGroupId, observedDescendantPids }) => ({
        leaderPid: processGroupId,
        processGroupId,
        descendantInspection: "verified" as const,
        observedDescendantPids: [...observedDescendantPids].sort((left, right) => left - right),
        descendantsClosed: true as const,
      })),
    };
  }
}

export function mergeArtifactProcessLifecycle(
  left: ArtifactCommandLifecycleSummary,
  right: ArtifactCommandLifecycleSummary,
): ArtifactCommandLifecycleSummary {
  if (left.survivingProcessGroupCount || right.survivingProcessGroupCount) {
    throw new Error("artifact lifecycle summary contains surviving process groups");
  }
  return {
    managedCommandCount: left.managedCommandCount + right.managedCommandCount,
    closedProcessGroupCount: left.closedProcessGroupCount + right.closedProcessGroupCount,
    survivingProcessGroupCount: 0,
    processGroups: [...left.processGroups, ...right.processGroups],
  };
}
