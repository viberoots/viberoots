{ pkgs, graphJsonPath }:
let
  # Read the graph at eval time so it becomes a strict input
  contents = builtins.readFile graphJsonPath;
  parsed = builtins.fromJSON contents;
  # Validate: must be a non-empty JSON array
  _typeCheck = if builtins.isList parsed then null else builtins.throw "graph.json must be a JSON list";
  _nonEmpty = if (builtins.length parsed) > 0 then null else builtins.throw "graph.json is empty";
  graphFile = builtins.toFile "graph.json" contents;
in pkgs.runCommand "buck-graph" {} ''
  set -eu
  mkdir -p "$out"
  install -Dm644 ${graphFile} "$out/graph.json"
''


