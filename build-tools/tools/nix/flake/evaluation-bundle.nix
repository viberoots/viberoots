{ repoRoot }:
let
  repoRootString = builtins.toString repoRoot;
  bundleRootString = builtins.dirOf repoRootString;
  canonicalBundleCandidate =
    builtins.baseNameOf repoRootString == "source"
    && builtins.match "/nix/store/[0-9abcdfghijklmnpqrsvwxyz]{32}-source" bundleRootString != null;
  schemaPathString = bundleRootString + "/schema.json";
in
if !canonicalBundleCandidate || !builtins.pathExists schemaPathString then null else
let
  bundleRoot = builtins.toPath bundleRootString;
  readJson = name: builtins.fromJSON (builtins.readFile (bundleRoot + "/${name}"));
  schema = readJson "schema.json";
  selection = readJson "selection.json";
  classification = readJson "classification.json";
  dependencies = readJson "dependency-inputs.json";
  languageOverrides = builtins.mapAttrs (_envName: overrides:
    builtins.mapAttrs (_key: relative: bundleRoot + "/${relative}") overrides
  ) (selection.languageOverrides or { });
in
assert schema.schema == "viberoots.evaluation-bundle.v1";
assert builtins.elem classification.classification [ "hermetic" "local-development" ];
assert builtins.match "/nix/store/[0-9abcdfghijklmnpqrsvwxyz]{32}-[^/]+" dependencies.artifactToolsRoot != null;
{
  inherit bundleRoot classification dependencies languageOverrides selection;
  artifactToolsRoot = dependencies.artifactToolsRoot;
  graphPath = bundleRoot + "/graph.json";
  repoRoot = repoRoot;
  rootModulesTomlPath =
    let relative = dependencies.rootModulesTomlPath or "";
    in if relative == "" then null else repoRoot + "/${relative}";
}
