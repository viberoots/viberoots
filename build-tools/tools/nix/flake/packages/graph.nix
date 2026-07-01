{ pkgs, repoSnapshot, uv2nixLib, repoRoot, nodeMods ? null, mkNodeMods ? null, nixpkgsRegistry ? null }:
let
  resolvedNodeMods =
    if nodeMods != null then nodeMods
    else if mkNodeMods != null then mkNodeMods { }
    else builtins.throw "packages/graph.nix requires nodeMods or mkNodeMods";
  graphGen =
    let
      envGraph = builtins.getEnv "BUCK_GRAPH_JSON";
      selectedTargetName = builtins.getEnv "BUCK_TARGET";
      workspaceGraph = repoRoot + "/.viberoots/workspace/buck/graph.json";
      testOverrideGraph = repoRoot + "/build-tools/tools/buck/graph.json";
      workspaceGraphExists = builtins.pathExists workspaceGraph;
      testOverrideGraphExists = builtins.pathExists testOverrideGraph;
      graphHasSelectedTarget = p:
        selectedTargetName != ""
        && builtins.pathExists p
        && pkgs.lib.hasInfix selectedTargetName (builtins.readFile p);
      graphPath =
        if envGraph != "" then envGraph
        else if selectedTargetName != "" && testOverrideGraphExists && (!workspaceGraphExists || (!(graphHasSelectedTarget workspaceGraph) && graphHasSelectedTarget testOverrideGraph)) then testOverrideGraph
        else workspaceGraph;
      graphArg =
        if (builtins.pathExists graphPath) then (builtins.path { path = graphPath; name = "graph.json"; }) else null;
    in
    pkgs.callPackage ../../graph-generator.nix {
      inherit pkgs;
      src = repoSnapshot;
      nodeMods = resolvedNodeMods;
      inherit nixpkgsRegistry;
      graphJsonPath = graphArg;
      rootModulesTomlPath =
        let
          envRootToml = builtins.getEnv "ROOT_GOMOD2NIX_TOML";
        in
        if envRootToml != "" then envRootToml else (repoRoot + "/gomod2nix.toml");
      uv2nixLib = uv2nixLib;
    };

  buckGraphFile = builtins.path { path = ../../buck-graph.nix; name = "buck-graph.nix"; };
  buckGraph = pkgs.callPackage buckGraphFile {
    inherit pkgs;
    graphJsonPath =
      let
        envGraph = builtins.getEnv "BUCK_GRAPH_JSON";
      in
      if envGraph != ""
      then (builtins.path { path = (builtins.toPath envGraph); name = "graph.json"; })
      else throw "BUCK_GRAPH_JSON not set; export the graph and pass it explicitly";
  };

  graphGenPure = pkgs.callPackage ../../graph-generator.nix {
    inherit pkgs;
    src = repoSnapshot;
    nodeMods = resolvedNodeMods;
    inherit nixpkgsRegistry;
    graphJsonPath =
      let
        envGraph = builtins.getEnv "BUCK_GRAPH_JSON";
      in
      if envGraph != "" then envGraph else (buckGraph + "/graph.json");
    rootModulesTomlPath =
      let
        envRootToml = builtins.getEnv "ROOT_GOMOD2NIX_TOML";
      in
      if envRootToml != "" then envRootToml else (repoRoot + "/gomod2nix.toml");
    uv2nixLib = uv2nixLib;
  };
in
{
  inherit graphGen buckGraph graphGenPure;
}
