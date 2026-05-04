import {
  resetSolverRuntimeForTests,
  setSolverWorkerFactoryForTests,
} from "../src/game/solver/solver-runtime";
import type { SolverResult } from "../src/game/solver/solver-types";

type SolveRequestMessage = {
  type: "solve-request";
  requestId: number;
  request: {
    lockedPlacements: readonly unknown[];
  };
};

type SolveResponseMessage = {
  type: "solve-result";
  requestId: number;
  result: SolverResult;
};

export type FakeWorkerControl = {
  requests: SolveRequestMessage[];
  respond: (message: SolveResponseMessage) => void;
};

const initialWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");

export function restoreWorkerForTests(): void {
  resetSolverRuntimeForTests();
  if (initialWorkerDescriptor) {
    Object.defineProperty(globalThis, "Worker", initialWorkerDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, "Worker");
}

export function installWorkerBackedRuntime(): { control: FakeWorkerControl } {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: class WorkerShim {},
  });

  const requests: SolveRequestMessage[] = [];
  let onmessage: ((event: MessageEvent<SolveResponseMessage>) => void) | null = null;
  setSolverWorkerFactoryForTests(() => {
    return {
      get onmessage() {
        return onmessage;
      },
      set onmessage(value) {
        onmessage = value as ((event: MessageEvent<SolveResponseMessage>) => void) | null;
      },
      onerror: null,
      postMessage(message: SolveRequestMessage) {
        requests.push(message);
      },
      terminate() {},
    } as unknown as Worker;
  });

  return {
    control: {
      requests,
      respond(message) {
        onmessage?.({ data: message } as MessageEvent<SolveResponseMessage>);
      },
    },
  };
}
