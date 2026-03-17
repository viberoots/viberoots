/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prewarmSolverRuntimeAssets,
  resetSolverRuntimeForTests,
  setSolverWorkerFactoryForTests,
} from "../src/game/solver/solver-runtime.ts";

describe("solver runtime prewarm", () => {
  const initialWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");

  afterEach(() => {
    vi.restoreAllMocks();
    resetSolverRuntimeForTests();
    if (initialWorkerDescriptor) {
      Object.defineProperty(globalThis, "Worker", initialWorkerDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Worker");
    }
  });

  it("eagerly creates the worker runtime and fetches solver wasm once", async () => {
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
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Uint8Array([0, 97, 115, 109]).buffer, { status: 200 }));

    prewarmSolverRuntimeAssets();
    prewarmSolverRuntimeAssets();
    await Promise.resolve();
    await Promise.resolve();

    expect(createdWorkerCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBeTypeOf("string");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("pleomino-solver");
  });
});
