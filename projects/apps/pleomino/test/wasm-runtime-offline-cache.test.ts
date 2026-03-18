/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prewarmSolverWasmAsset,
  resetSolverWasmForTests,
} from "../src/game/solver/wasm-runtime.ts";

describe("solver wasm runtime offline cache fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetSolverWasmForTests();
    Reflect.deleteProperty(globalThis, "caches");
  });

  it("does not require a network fetch to prewarm solver wasm bytes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const cacheMatch = vi.fn(async (request: string | Request) => {
      const url = typeof request === "string" ? request : request.url;
      if (!url.includes("pleomino-solver")) {
        return undefined;
      }
      return new Response(new Uint8Array([0, 97, 115, 109]).buffer, { status: 200 });
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      writable: true,
      value: {
        match: cacheMatch,
      },
    });

    prewarmSolverWasmAsset();
    await Promise.resolve();
    await Promise.resolve();
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
