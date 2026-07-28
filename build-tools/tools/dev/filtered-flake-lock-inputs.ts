type SnapshotFlakeLock = {
  nodes?: Record<string, Record<string, unknown>>;
  root?: string;
};

const exactViberootsLockInputs = ["rust-overlay", "wasmtime-nixpkgs"] as const;

export function syncExactViberootsInputs(
  snapshotLock: SnapshotFlakeLock,
  sourceLock: SnapshotFlakeLock,
): void {
  const sourceRoot = String(sourceLock.root || "root");
  const sourceInputs = sourceLock.nodes?.[sourceRoot]?.inputs as
    | Record<string, unknown>
    | undefined;
  const snapshotNode = snapshotLock.nodes?.viberoots;
  if (!snapshotNode) throw new Error("[filtered-flake] snapshot viberoots lock node is absent");
  const targetInputs = { ...((snapshotNode.inputs || {}) as Record<string, unknown>) };

  for (const input of exactViberootsLockInputs) {
    const sourceRef = sourceInputs?.[input];
    if (sourceRef == null) {
      throw new Error(`[filtered-flake] immutable source lock input ${input} is absent`);
    }
    if (Array.isArray(sourceRef)) {
      targetInputs[input] = rebaseFollowPath(sourceRef);
      continue;
    }
    if (typeof sourceRef !== "string") {
      throw new Error(`[filtered-flake] immutable source lock input ${input} is malformed`);
    }
    const sourceNode = sourceLock.nodes?.[sourceRef];
    if (!sourceNode) {
      throw new Error(`[filtered-flake] immutable source lock node ${sourceRef} is absent`);
    }
    const embeddedNode = rebaseLockNodeFollows(sourceNode);
    const existingRef = targetInputs[input];
    if (
      typeof existingRef === "string" &&
      snapshotLock.nodes?.[existingRef] &&
      !lockNodeIsShared(snapshotLock, existingRef)
    ) {
      snapshotLock.nodes[existingRef] = embeddedNode;
      continue;
    }
    let targetRef = sourceRef;
    let suffix = 2;
    while (snapshotLock.nodes?.[targetRef]) targetRef = `${sourceRef}_${suffix++}`;
    snapshotLock.nodes![targetRef] = embeddedNode;
    targetInputs[input] = targetRef;
  }
  snapshotNode.inputs = targetInputs;
}

function rebaseFollowPath(value: unknown[]): unknown[] {
  return ["viberoots", ...structuredClone(value)];
}

function rebaseLockNodeFollows(sourceNode: Record<string, unknown>): Record<string, unknown> {
  const embedded = structuredClone(sourceNode);
  if (!isRecord(embedded.inputs)) return embedded;
  embedded.inputs = Object.fromEntries(
    Object.entries(embedded.inputs).map(([name, inputRef]) => [
      name,
      Array.isArray(inputRef) ? rebaseFollowPath(inputRef) : inputRef,
    ]),
  );
  return embedded;
}

function lockNodeIsShared(lock: SnapshotFlakeLock, ref: string): boolean {
  return Object.entries(lock.nodes || {}).some(([nodeName, node]) => {
    if (nodeName === "viberoots") return false;
    const inputs = (node.inputs || {}) as Record<string, unknown>;
    return Object.values(inputs).some((inputRef) => inputRef === ref);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
