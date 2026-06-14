#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_action_runner helpers assemble stable cmd snippets (cquery)", async () => {
  await runInTemp("nix-action-runner-cmd-snippets", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "probe");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/lang:nix_shell.bzl", "escape_buck_cmd_subst")',
        'load("//build-tools/lang:nix_action_runner.bzl", "nix_action_shell_prefix_core", "nix_action_export_graph_cmd", "nix_action_build_selected_out_path_cmd")',
        "",
        "genrule(",
        '  name = "probe",',
        '  out = "probe.txt",',
        "  cmd = escape_buck_cmd_subst(",
        "    nix_action_shell_prefix_core()",
        "    + nix_action_export_graph_cmd()",
        '    + nix_action_build_selected_out_path_cmd("//projects/apps/probe:probe", zx_wrapper = "path:$FLK_ROOT#zx-wrapper")',
        '    + "echo ok > $OUT"',
        "  ),",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/probe:probe`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");

    const idxBootstrap = out.indexOf("export WORKSPACE_ROOT=");
    assert.ok(idxBootstrap >= 0, "expected nix bootstrap fragments in cmd");
    assert.ok(
      out.includes("export VIBEROOTS_ROOT="),
      "expected nix bootstrap to resolve the viberoots source root",
    );

    const exportGraphPath = "$VIBEROOTS_ROOT/build-tools/tools/buck/export-graph.ts";
    const zxInitPath = "$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs";
    const buildSelectedPath = "$VIBEROOTS_ROOT/build-tools/tools/dev/build-selected.ts";

    const idxExportGraph = out.indexOf(exportGraphPath);
    assert.ok(idxExportGraph > idxBootstrap, "expected export-graph snippet after bootstrap");
    assert.ok(
      out.includes(`VBR_NODE_ZX_INIT=\\"${zxInitPath}\\"`),
      "expected export-graph snippet to import zx-init from VIBEROOTS_ROOT",
    );
    assert.ok(
      out.includes("node --experimental-top-level-await") &&
        out.includes("--experimental-strip-types") &&
        out.includes(`${exportGraphPath}\\" --out`),
      "expected export-graph snippet to prefer direct node execution",
    );
    assert.ok(
      out.includes("path:$VIBEROOTS_ROOT#zx-wrapper") &&
        out.includes(`${exportGraphPath}\\" --out`),
      "expected export-graph nix fallback to use the viberoots flake source",
    );

    const idxBuildSelected = out.indexOf(buildSelectedPath);
    assert.ok(
      idxBuildSelected > idxExportGraph,
      "expected build-selected snippet after export-graph",
    );

    assert.ok(
      out.includes("--accept-flake-config"),
      "expected build-selected fallback invocation to pass --accept-flake-config",
    );
    assert.ok(
      out.includes(`VBR_NODE_ZX_INIT=\\"${zxInitPath}\\"`) &&
        out.includes("node --experimental-top-level-await") &&
        out.includes(`${buildSelectedPath}\\"; else`),
      "expected build-selected snippet to prefer direct node execution from VIBEROOTS_ROOT",
    );
    assert.ok(
      out.includes("ZX_WRAPPER_REF=") &&
        out.includes('ZX_WRAPPER_REF=\\"path:$FLK_ROOT#zx-wrapper\\"') &&
        !out.includes('if [ -f \\"$VIBEROOTS_ROOT/flake.nix\\" ]'),
      "expected build-selected nix fallback to honor the caller-provided flake ref",
    );
    assert.ok(
      out.includes('${TIMEOUT:+$TIMEOUT }nix run --accept-flake-config \\"$ZX_WRAPPER_REF\\"'),
      "expected build-selected nix fallback to use the resolved wrapper flake",
    );
    assert.ok(out.includes("sed -E"), "expected build-selected out-path parsing to strip ANSI");

    assert.equal(
      out.includes("$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs"),
      false,
      "expected zx-init source lookup to avoid WORKSPACE_ROOT",
    );
    assert.equal(
      out.includes("$WORKSPACE_ROOT/build-tools/tools/buck/export-graph.ts"),
      false,
      "expected export-graph source lookup to avoid WORKSPACE_ROOT",
    );
    assert.equal(
      out.includes("$FLK_ROOT/build-tools/tools/dev/build-selected.ts"),
      false,
      "expected build-selected source lookup to avoid FLK_ROOT",
    );
  });
});
