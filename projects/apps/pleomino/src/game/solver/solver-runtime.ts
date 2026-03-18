import { solveBoardWithWasm } from "./solver";
import type { SolverRequest, SolverResult } from "./solver-types";
import { prewarmSolverWasmAsset } from "./wasm-runtime";

type SolveWorkerRequest = {
  type: "solve-request";
  requestId: number;
  request: SolverRequest;
};

type SolveWorkerResponse =
  | {
      type: "solve-result";
      requestId: number;
      result: SolverResult;
    }
  | {
      type: "solve-error";
      requestId: number;
      message: string;
    };

type PendingSolve = {
  resolve: (value: SolverResult) => void;
  reject: (reason?: unknown) => void;
};

let workerFactory: (() => Worker) | null = null;
let workerRef: Worker | null = null;
let nextRequestId = 1;
const pendingByRequestId = new Map<number, PendingSolve>();
let prewarmStarted = false;

function canUseWorkerRuntime(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./solver-runtime-worker.ts", import.meta.url), { type: "module" });
}

function resolveWorkerFactory(): () => Worker {
  return workerFactory ?? defaultWorkerFactory;
}

function rejectPending(error: Error): void {
  const pending = [...pendingByRequestId.values()];
  pendingByRequestId.clear();
  for (const entry of pending) {
    entry.reject(error);
  }
}

function detachWorker(): void {
  if (!workerRef) {
    return;
  }
  workerRef.onmessage = null;
  workerRef.onerror = null;
  workerRef.terminate();
  workerRef = null;
}

function handleWorkerMessage(event: MessageEvent<SolveWorkerResponse>): void {
  const payload = event.data;
  const pending = pendingByRequestId.get(payload.requestId);
  if (!pending) {
    return;
  }
  pendingByRequestId.delete(payload.requestId);
  if (payload.type === "solve-result") {
    pending.resolve(payload.result);
    return;
  }
  pending.reject(new Error(payload.message));
}

function createWorker(): Worker {
  const worker = resolveWorkerFactory()();
  worker.onmessage = (event) => {
    handleWorkerMessage(event as MessageEvent<SolveWorkerResponse>);
  };
  worker.onerror = () => {
    detachWorker();
    rejectPending(new Error("worker solve runtime failed"));
  };
  return worker;
}

function getOrCreateWorker(): Worker {
  if (workerRef) {
    return workerRef;
  }
  workerRef = createWorker();
  return workerRef;
}

function requestWorkerSolve(request: SolverRequest): Promise<SolverResult> {
  const worker = getOrCreateWorker();
  const requestId = nextRequestId;
  nextRequestId += 1;
  return new Promise((resolve, reject) => {
    pendingByRequestId.set(requestId, { resolve, reject });
    const payload: SolveWorkerRequest = {
      type: "solve-request",
      requestId,
      request,
    };
    worker.postMessage(payload);
  });
}

export async function solveBoardWithRuntime(request: SolverRequest): Promise<SolverResult> {
  if (!canUseWorkerRuntime()) {
    return solveBoardWithWasm(request);
  }
  try {
    const workerResult = await requestWorkerSolve(request);
    if (workerResult.status === "unsolved" && request.lockedPlacements.length > 0) {
      return solveBoardWithWasm(request);
    }
    return workerResult;
  } catch {
    detachWorker();
    return solveBoardWithWasm(request);
  }
}

export function prewarmSolverRuntimeAssets(): void {
  if (prewarmStarted || typeof window === "undefined") {
    return;
  }
  prewarmStarted = true;
  prewarmSolverWasmAsset();
  if (!canUseWorkerRuntime()) {
    return;
  }
  try {
    getOrCreateWorker();
  } catch {
    detachWorker();
  }
}

export function resetSolverRuntimeForTests(): void {
  rejectPending(new Error("runtime reset"));
  detachWorker();
  nextRequestId = 1;
  workerFactory = null;
  prewarmStarted = false;
}

export function setSolverWorkerFactoryForTests(factory: (() => Worker) | null): void {
  resetSolverRuntimeForTests();
  workerFactory = factory;
}
