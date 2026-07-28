#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCppWasmContract, wasmStaticProducer } from "./rust-wasm-cpp-contract-eval";
import { evaluate, evaluateTinyGo, wasiProducer } from "./rust-wasm-link-compatibility-eval";

test("Rust WASM consumes compatible Rust and C++ static archives through dependencyArtifactOf", async () => {
  for (const labels of [
    ["lang:rust", "kind:wasm", "wasm:static", "wasm_abi:bare"],
    ["lang:cpp", "kind:wasm", "wasm:static"],
    ["lang:go", "kind:wasm", "wasm:static", "wasm_abi:bare"],
  ]) {
    const language = labels.includes("lang:rust")
      ? "rust"
      : labels.includes("lang:go")
        ? "go"
        : "cpp";
    const result = await evaluate(
      wasmStaticProducer(language, { labels, wasm_link_kind: "static" }),
    );
    assert.equal(result.exitCode, 0, String(result.stderr));
    assert.deepEqual(JSON.parse(String(result.stdout)).labels, ["//projects/libs/producer:static"]);
    assert.match(String(result.stdout), /artifact-producer:static/);
  }
});

test("Rust WASM rejects ABI and runtime authority mismatches before construction", async () => {
  for (const changed of [
    { wasm_abi: "wasi", wasm_target: "wasm32-wasip1" },
    { wasm_target: "wasm32-wasip1" },
    { wasm_allocator: "jemalloc" },
    { wasm_libc: "wasi-libc" },
    { wasm_runtime: "browser" },
    { wasm_exception_policy: "unwind" },
  ]) {
    const result = await evaluate(
      wasmStaticProducer("rust", { wasm_link_kind: "static", ...changed }),
    );
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr),
      /incompatible|allocator authority|exception policy|link-only runtime authority/,
    );
  }
});

test("Rust WASI accepts C++ and Rust authorities and rejects TinyGo allocator ownership", async () => {
  for (const [language, target, allocator] of [
    ["cpp", "wasm32-wasi", "none"],
    ["rust", "wasm32-wasip1", "rust"],
  ]) {
    const result = await evaluate(wasiProducer(language as "cpp" | "rust", target, allocator), {
      wasm_abi: "wasi",
      wasm_target: "wasm32-wasip1",
      wasm_libc: "wasi-libc",
      wasm_runtime: "wasi-preview1",
    });
    assert.equal(result.exitCode, 0, String(result.stderr));
  }
  const unsupported = await evaluate(wasiProducer("go", "wasm32-wasip1", "tinygo"), {
    wasm_abi: "wasi",
    wasm_target: "wasm32-wasip1",
    wasm_libc: "wasi-libc",
    wasm_runtime: "wasi-preview1",
  });
  assert.notEqual(unsupported.exitCode, 0);
  assert.match(String(unsupported.stderr), /unsupported TinyGo WASI static archive/);
});

test("TinyGo consumers validate Rust static WASM target and runtime authorities", async () => {
  const producer = wasmStaticProducer("rust", {
    labels: ["lang:rust", "kind:wasm", "wasm:static", "wasm_abi:bare"],
  });
  const compatible = await evaluateTinyGo(producer);
  assert.equal(compatible.exitCode, 0, String(compatible.stderr));
  assert.match(String(compatible.stdout), /artifact-producer:static/);

  for (const changed of [
    { wasm_target: "wasm32-wasip1" },
    { wasm_allocator: "jemalloc" },
    { wasm_libc: "wasi-libc" },
    { wasm_exception_policy: "unwind" },
    { wasm_runtime: "browser" },
  ]) {
    const result = await evaluateTinyGo({ ...producer, ...changed });
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /incompatible .* authority/);
  }
});

test("TinyGo planner distinguishes selected ABI from an explicit graph ABI", async () => {
  const bare = wasmStaticProducer("rust", {
    labels: ["lang:rust", "kind:wasm", "wasm:static", "wasm_abi:bare"],
  });
  const wasi = wasiProducer("rust", "wasm32-wasip1", "rust");

  const selectedWasi = await evaluateTinyGo(
    wasi,
    { wasm_abi: "bare", wasm_abi_explicit: false },
    "wasi_single",
  );
  assert.equal(selectedWasi.exitCode, 0, String(selectedWasi.stderr));

  const explicitBare = await evaluateTinyGo(
    bare,
    { wasm_abi: "bare", wasm_abi_explicit: true },
    "wasi_single",
  );
  assert.equal(explicitBare.exitCode, 0, String(explicitBare.stderr));

  const explicitWasi = await evaluateTinyGo(
    wasi,
    { wasm_abi: "wasi", wasm_abi_explicit: true },
    "wasm",
  );
  assert.equal(explicitWasi.exitCode, 0, String(explicitWasi.stderr));
});

test("TinyGo WASI consumers accept reviewed Rust and C++ producers and reject TinyGo archives", async () => {
  for (const [language, target, allocator] of [
    ["rust", "wasm32-wasip1", "rust"],
    ["cpp", "wasm32-wasi", "none"],
  ]) {
    const result = await evaluateTinyGo(
      wasiProducer(language as "cpp" | "rust", target, allocator),
      { wasm_abi: "wasi", wasm_abi_explicit: true },
    );
    assert.equal(result.exitCode, 0, String(result.stderr));
  }
  const unsupported = await evaluateTinyGo(wasiProducer("go", "wasm32-wasip1", "tinygo"), {
    wasm_abi: "wasi",
    wasm_abi_explicit: true,
  });
  assert.notEqual(unsupported.exitCode, 0);
  assert.match(String(unsupported.stderr), /unsupported.*lang:cpp or lang:rust/);
});

test("C++ static consumers validate exact Rust and TinyGo WASM authorities", async () => {
  const producer = wasmStaticProducer("go");
  assert.equal((await evaluateCppWasmContract(producer)).exitCode, 0);
  for (const changed of [
    { wasm_target: "wasm32-wasip1" },
    { wasm_allocator: "jemalloc" },
    { wasm_libc: "wasi-libc" },
    { wasm_exception_policy: "unwind" },
    { wasm_runtime: "browser" },
  ]) {
    const result = await evaluateCppWasmContract({ ...producer, ...changed });
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /incompatible/);
  }
});

test("C++ WASI consumers accept Rust and reject TinyGo allocator ownership", async () => {
  const consumer = {
    wasm_abi: "wasi",
    wasm_target: "wasm32-wasip1",
    wasm_libc: "wasi-libc",
  };
  const rust = await evaluateCppWasmContract(
    wasiProducer("rust", "wasm32-wasip1", "rust"),
    consumer,
  );
  assert.equal(rust.exitCode, 0, String(rust.stderr));
  const tinyGo = await evaluateCppWasmContract(
    wasiProducer("go", "wasm32-wasip1", "tinygo"),
    consumer,
  );
  assert.notEqual(tinyGo.exitCode, 0);
  assert.match(String(tinyGo.stderr), /unsupported TinyGo WASI static archive/);
});
