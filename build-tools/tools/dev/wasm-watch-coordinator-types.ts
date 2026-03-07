import crypto from "node:crypto";

export type CoordinatorLeaseSubscription = {
  taskKey: string;
  moduleKey: string;
  moduleType: "wasm";
  buildCommand: string;
  buildCwd: string;
  buildOut: string;
  watchPaths: string[];
  syncOuts: string[];
};

export type CoordinatorLease = {
  schemaVersion: 1;
  appId: string;
  leaseId: string;
  updatedAtMs: number;
  subscriptions: CoordinatorLeaseSubscription[];
};

export type CoordinatorTask = {
  taskKey: string;
  moduleType: "wasm";
  buildCommand: string;
  buildCwd: string;
  buildOut: string;
  watchPaths: string[];
  syncOuts: string[];
  subscribers: string[];
};

function normalized(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function computeTaskKey(input: {
  moduleType: "wasm";
  buildCommand: string;
  watchPaths: string[];
}): string {
  const payload = JSON.stringify({
    moduleType: input.moduleType,
    buildCommand: String(input.buildCommand || "").trim(),
    watchPaths: normalized(input.watchPaths || []),
  });
  const digest = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 20);
  return `wasm-${digest}`;
}

export function normalizeSubscription(
  sub: CoordinatorLeaseSubscription,
): CoordinatorLeaseSubscription {
  return {
    ...sub,
    taskKey: String(sub.taskKey || "").trim(),
    moduleKey: String(sub.moduleKey || "").trim(),
    moduleType: "wasm",
    buildCommand: String(sub.buildCommand || "").trim(),
    buildCwd: String(sub.buildCwd || "").trim(),
    buildOut: String(sub.buildOut || "").trim(),
    watchPaths: normalized(sub.watchPaths || []),
    syncOuts: normalized(sub.syncOuts || []),
  };
}
