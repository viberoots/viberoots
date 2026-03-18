/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prewarmSolverRuntimeAssets,
  resetSolverRuntimeForTests,
  setSolverWorkerFactoryForTests,
} from "../src/game/solver/solver-runtime.ts";
import { resetSolverWasmForTests } from "../src/game/solver/wasm-runtime.ts";

describe("solver runtime prewarm", () => {
  const initialWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");

  afterEach(() => {
    vi.restoreAllMocks();
    resetSolverRuntimeForTests();
    resetSolverWasmForTests();
    if (initialWorkerDescriptor) {
      Object.defineProperty(globalThis, "Worker", initialWorkerDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Worker");
    }
  });

  it("eagerly creates the worker runtime and primes solver wasm bytes once", async () => {
    let createdWorkerCount = 0;
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: class WorkerShim {},
    });
    setSolverWorkerFactoryForTests(() => {
      createdWorkerCount += 1;
      return {
        onmessage: null,
        onerror: null,
        postMessage() {},
        terminate() {},
      } as unknown as Worker;
    });
    prewarmSolverRuntimeAssets();
    prewarmSolverRuntimeAssets();
    await Promise.resolve();
    await Promise.resolve();

    expect(createdWorkerCount).toBe(1);
  });
});
