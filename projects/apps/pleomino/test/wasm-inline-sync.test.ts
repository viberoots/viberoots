import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { SOLVER_WASM_BASE64 } from "../src/game/solver/wasm-inline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("inline wasm asset", () => {
  it("matches the checked-in solver wasm file byte-for-byte", () => {
    const wasmPath = path.resolve(__dirname, "../src/wasm-contract/pleomino-solver.wasm");
    const fileBytes = readFileSync(wasmPath);
    const inlineBytes = Buffer.from(SOLVER_WASM_BASE64, "base64");
    expect(inlineBytes.equals(fileBytes)).toBe(true);
  });
});
