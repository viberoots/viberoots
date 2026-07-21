#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { bzlDefBody } from "./nix-gaps-inventory-check-lib";

type NodeRouteCheckInput = {
  hasNodeImplementationFiles: boolean;
  nixRouteDetailsByMacro: Record<string, string>;
};

async function sourceRoot(): Promise<string> {
  const envRoot = String(
    process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || "",
  ).trim();
  if (envRoot) return envRoot;
  if (await fs.pathExists(path.join("viberoots", "build-tools"))) return path.resolve("viberoots");
  return process.cwd();
}

export async function enforceNodeImplementationRouteChecks({
  hasNodeImplementationFiles,
  nixRouteDetailsByMacro,
}: NodeRouteCheckInput): Promise<void> {
  if (!hasNodeImplementationFiles) return;

  const source = await sourceRoot();
  const nodeDefsCoreTxt = await fs.readFile(
    path.join(source, "build-tools", "node", "defs_core.bzl"),
    "utf8",
  );
  const nodeDefsStageTxt = await fs.readFile(
    path.join(source, "build-tools", "node", "defs_stage.bzl"),
    "utf8",
  );
  const coreNixClaimed = ["nix_node_gen", "nix_node_lib", "nix_node_bin"].some(
    (macro) => !!nixRouteDetailsByMacro[macro],
  );

  if (coreNixClaimed) {
    const missingCoreSignals: string[] = [];
    if (!nodeDefsCoreTxt.includes('planner_name = name + "__planner"')) {
      missingCoreSignals.push("defs_core missing planner companion target for nix_node_gen");
    }
    if (!nodeDefsCoreTxt.includes('wiring = "nix_calling_genrule"')) {
      missingCoreSignals.push(
        "defs_core missing nix_calling_genrule wiring for public nix_node_gen",
      );
    }
    if (!nodeDefsCoreTxt.includes("nix_action_build_selected_out_path_cmd(")) {
      missingCoreSignals.push(
        "defs_core missing canonical nix_action_build_selected_out_path_cmd route for nix_node_gen",
      );
    }
    if (missingCoreSignals.length > 0) {
      console.error("Node implementation route checks failed for nix_node_gen/lib/bin:");
      for (const msg of missingCoreSignals) console.error(`- ${msg}`);
      process.exit(1);
    }
  }

  const stageInlineMacros = ["node_asset_stage", "node_wasm_inline_module"] as const;
  for (const macro of stageInlineMacros) {
    const routeDetail = nixRouteDetailsByMacro[macro];
    if (!routeDetail) continue;
    const macroBody = bzlDefBody(nodeDefsStageTxt, macro);
    if (macroBody === "") {
      console.error(`Node implementation route checks failed: defs_stage missing macro ${macro}`);
      process.exit(1);
    }
    const docsClaimWrapper = routeDetail.includes("nix_node_gen");
    const docsClaimStandalone = routeDetail.includes("standalone nix-calling genrule");
    if (!docsClaimWrapper && !docsClaimStandalone) {
      console.error(`Node route docs for ${macro} are ambiguous: (${routeDetail}).`);
      console.error(
        "- Expected route detail to include either 'nix_node_gen' or 'standalone nix-calling genrule'.",
      );
      process.exit(1);
    }
    const hasWrapperRoute = macroBody.includes("nix_node_gen(");
    const hasStandaloneBootstrap = macroBody.includes("nix_calling_genrule_bootstrap(");
    const hasStandaloneGraphEnv = macroBody.includes("nix_calling_env_export_buck_graph_json(");
    const hasDirectSelectedBuild = macroBody.includes("nix_action_build_selected_out_path_cmd(");
    const hasSharedSelectedRouteHelperCall = macroBody.includes("_selected_route_build_cmd(");
    const hasSharedSelectedRouteHelperDef =
      nodeDefsStageTxt.includes("def _selected_route_build_cmd(") &&
      nodeDefsStageTxt.includes("nix_action_build_selected_out_path_cmd(");
    const hasStandaloneSelectedBuild =
      hasDirectSelectedBuild ||
      (hasSharedSelectedRouteHelperCall && hasSharedSelectedRouteHelperDef);
    const hasStandaloneWiring = macroBody.includes("_prepare_node_nix_calling_genrule(");
    const hasStandaloneRoute =
      hasStandaloneBootstrap &&
      hasStandaloneGraphEnv &&
      hasStandaloneSelectedBuild &&
      hasStandaloneWiring;

    if (docsClaimWrapper && !hasWrapperRoute) {
      console.error(
        `Node route docs/implementation mismatch for ${macro}: docs claim nix_node_gen wrapper route but implementation does not call nix_node_gen.`,
      );
      process.exit(1);
    }
    if (docsClaimStandalone && !hasStandaloneRoute) {
      console.error(
        `Node route invariant failure for ${macro}: expected standalone nix-calling genrule contract.`,
      );
      if (!hasStandaloneWiring)
        console.error("- missing _prepare_node_nix_calling_genrule(...) wiring");
      if (!hasStandaloneBootstrap)
        console.error("- missing nix_calling_genrule_bootstrap(...) in command assembly");
      if (!hasStandaloneGraphEnv)
        console.error("- missing nix_calling_env_export_buck_graph_json(...) in command assembly");
      if (!hasStandaloneSelectedBuild)
        console.error(
          "- missing nix_action_build_selected_out_path_cmd(...) selected-build capture",
        );
      process.exit(1);
    }
  }
}
