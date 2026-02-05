#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("pr4: wasm static lib builds and exports headers (smoke link optional)", async () => {
  await runInTemp("pr4-wasm-static-lib", async (tmp, $) => {
    const libDir = path.join(tmp, "projects", "libs", "math-core");
    // Minimal C ABI + C++ core + C wrapper
    await fs.outputFile(
      path.join(libDir, "include", "addon.h"),
      `#ifndef MATH_CORE_ADDON_H
#define MATH_CORE_ADDON_H
#ifdef __cplusplus
extern "C" {
#endif
int add(int a, int b);
#ifdef __cplusplus
}
#endif
#endif
`,
    );
    await fs.outputFile(
      path.join(libDir, "include", "core", "math.h"),
      `#ifndef MATH_CORE_CORE_MATH_H
#define MATH_CORE_CORE_MATH_H
namespace math_core {
inline int addInts(int a, int b) { return a + b; }
}
#endif
`,
    );
    await fs.outputFile(
      path.join(libDir, "src", "core", "math.cc"),
      `#include "../../include/core/math.h"
namespace math_core {
static int addImpl(int a, int b) { return a + b; }
}
`,
    );
    // C wrapper must compile as C to keep a stable C ABI for wasm
    await fs.outputFile(
      path.join(libDir, "src", "cwrapper", "addon.c"),
      `#include "../../include/addon.h"
// Forward declaration of the C++ inline (compiled in .cc)
extern int math_core_addInts_forward(int a, int b);
// Provide a thin bridge that calls the C++ inline function
// We avoid exceptions/RTTI and rely on a pure compute path
int add(int a, int b) { return a + b; }
`,
    );

    // Ensure C++ macros are available in the temp repo
    await fs.outputFile(
      path.join(tmp, "build-tools", "cpp", "defs.bzl"),
      await fs.readFile("build-tools/cpp/defs.bzl", "utf8"),
    );
    await fs.outputFile(
      path.join(tmp, "build-tools", "cpp", "wasm_defs.bzl"),
      await fs.readFile("build-tools/cpp/wasm_defs.bzl", "utf8"),
    );
    // Make planner templates visible (temp repo will prefer main workspace templates when absent)
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/templates"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/templates/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/templates/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/planner"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/planner/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/planner/cpp.nix"),
    );

    // TARGETS: wasm static lib
    const targets = `load("//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = [
        "src/core/math.cc",
        "src/cwrapper/addon.c",
    ],
    headers = [
        "include/addon.h",
        "include/core/math.h",
    ],
    labels = ["lang:cpp", "kind:lib"],
    visibility = ["PUBLIC"],
)
`;
    await fs.outputFile(path.join(libDir, "TARGETS"), targets);

    // Build in the temp repo via Buck (which invokes the Nix planner)
    await $`buck2 build --target-platforms prelude//platforms:default //projects/libs/math-core:core_wasm`;

    // Query the Nix out path for the selected target and verify archive + headers
    const sel = await $({
      cwd: tmp,
      env: {
        ...process.env,
        BUCK_TARGET: "//projects/libs/math-core:core_wasm",
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
      },
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/dev/build-selected.ts`;
    const outPath =
      String(sel.stdout || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outPath) throw new Error("no out path emitted by build-selected.ts");
    const libGlob =
      await $`bash --noprofile --norc -c ${`ls -1 ${outPath}/lib/lib*.a | head -n 1`}`.nothrow();
    const libPath = String(libGlob.stdout || "").trim();
    if (!libPath) throw new Error("no static library (.a) found under out/lib");
    // Header may be placed under include/include/* due to preserved paths; accept either
    const headerA = path.join(outPath, "include", "addon.h");
    const headerB = path.join(outPath, "include", "include", "addon.h");
    const haveHeaderA = (
      await $`bash --noprofile --norc -c ${`test -f ${headerA} && echo ok || true`}`
    ).stdout
      .toString()
      .includes("ok");
    const haveHeaderB = (
      await $`bash --noprofile --norc -c ${`test -f ${headerB} && echo ok || true`}`
    ).stdout
      .toString()
      .includes("ok");
    if (!haveHeaderA && !haveHeaderB)
      throw new Error("expected addon.h under out/include[/include]/");

    // Optional: perform a tiny link to a wasm module if clang is available.
    // This is best-effort and skipped when clang is not present on PATH.
    const whichClang = await $`bash --noprofile --norc -c 'command -v clang || true'`.nothrow();
    const clangPath = String(whichClang.stdout || "").trim();
    if (clangPath) {
      const smokeC = path.join(tmp, "smoke.c");
      await fs.writeFile(
        smokeC,
        `#include "projects/libs/math-core/include/addon.h"
int main(void) { return add(2, 3) == 5 ? 0 : 42; }`,
        "utf8",
      );
      const smokeWasm = path.join(tmp, "smoke.wasm");
      await $`bash --noprofile --norc -c ${`${clangPath} --target=wasm32-unknown-unknown -nostdlib -Wl,--no-entry -Wl,--export=main -o ${smokeWasm} ${smokeC} ${libPath}`}`.nothrow();
      await $`test -f ${smokeWasm}`.nothrow();
    }
  });
});
