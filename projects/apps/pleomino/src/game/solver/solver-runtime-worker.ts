import { solveBoardWithWasm } from "./solver";
import type { SolverRequest, SolverResult } from "./solver-types";

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

type WorkerScope = Worker & {
  onmessage: ((event: MessageEvent<SolveWorkerRequest>) => void) | null;
  postMessage: (message: SolveWorkerResponse) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = async (event) => {
  const payload = event.data;
  if (payload?.type !== "solve-request") {
    return;
  }
  try {
    const result = await solveBoardWithWasm(payload.request);
    scope.postMessage({
      type: "solve-result",
      requestId: payload.requestId,
      result,
    });
  } catch (error) {
    scope.postMessage({
      type: "solve-error",
      requestId: payload.requestId,
      message: error instanceof Error ? error.message : "unknown worker solve failure",
    });
  }
};
