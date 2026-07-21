#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";
import { runInTemp } from "../lib/test-helpers";

test("nix_action_runner helpers assemble stable cmd snippets (cquery)", async () => {
  await runInTemp("nix-action-runner-cmd-snippets", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "probe");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:nix_shell.bzl", "escape_buck_cmd_subst", "nix_build_out_path_cmd")',
        'load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_shell_prefix_core", "nix_action_export_graph_cmd", "nix_action_build_selected_out_path_cmd")',
        "",
        "genrule(",
        '  name = "probe",',
        '  out = "probe.txt",',
        "  cmd = escape_buck_cmd_subst(",
        "    nix_action_shell_prefix_core()",
        "    + nix_action_export_graph_cmd()",
        '    + nix_action_build_selected_out_path_cmd("//projects/apps/probe:probe")',
        '    + nix_build_out_path_cmd(".#probe", timeout_var = "")',
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
    assert.equal(probe.exitCode, 0, String(probe.stderr || probe.stdout || ""));
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
    const idxBuildSelected = out.indexOf(buildSelectedPath);
    assert.ok(
      idxBuildSelected > idxExportGraph,
      "expected build-selected snippet after export-graph",
    );

    assert.ok(
      out.includes(`VBR_NODE_ZX_INIT=\\"${zxInitPath}\\"`) &&
        out.includes("node --experimental-top-level-await") &&
        out.includes(
          `${buildSelectedPath}\\" --target \\"//projects/apps/probe:probe\\" --attr graph-generator-selected --buck-action-inputs`,
        ),
      "expected build-selected to use explicit Buck action provenance",
    );
    assert.ok(
      out.includes("env -u WORKSPACE_ROOT -u BUCK_TEST_SRC node"),
      "expected ambient workspace selectors to be removed before canonical entry",
    );
    assert.ok(
      out.includes("--workspace-root") &&
        out.includes("--buck-test-src") &&
        out.includes("--buck-graph-json") &&
        out.includes("--artifact-tools-marker") &&
        out.includes("--buck-action-state-root"),
      "expected declared Buck selectors and owned state to cross the action boundary through argv",
    );
    assert.ok(
      out.includes("buck-out/tmp/build-selected"),
      "expected build-selected stderr to stay under the workspace buck-out temp tree",
    );
    assert.ok(
      out.includes("VBR_BUILD_SELECTED_LOG_DIR/.metadata_never_index"),
      "expected build-selected log directory to be excluded from macOS metadata indexing",
    );
    assert.equal(
      out.includes("/tmp/build-selected.log"),
      false,
      "expected build-selected stderr to avoid the global /tmp fallback",
    );
    assert.ok(out.includes("sed -E"), "expected build-selected out-path parsing to strip ANSI");
    assert.ok(out.includes("--option substituters"), "expected exact action cache policy");
    assert.ok(out.includes("--option trusted-public-keys"), "expected exact action key policy");
    for (const value of [...REVIEWED_SUBSTITUTERS, ...REVIEWED_PUBLIC_KEYS]) {
      assert.ok(out.includes(value), `expected reviewed action policy value ${value}`);
    }

    assert.equal(
      out.includes("$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs"),
      false,
      "expected zx-init source execution to avoid legacy root build-tools",
    );
    assert.equal(
      out.includes("$WORKSPACE_ROOT/build-tools/tools/buck/export-graph.ts"),
      false,
      "expected export-graph source execution to avoid legacy root build-tools",
    );
    assert.equal(
      out.includes("$FLK_ROOT/viberoots/build-tools/tools/dev/build-selected.ts"),
      false,
      "expected build-selected source lookup to avoid FLK_ROOT",
    );
  });
});
