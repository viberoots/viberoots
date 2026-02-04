{
  # Mapping of planner languages to their dev override environment variables.
  # Source of truth: build-tools/tools/lib/dev-override-envs.json (shared with TS tooling).
  #
  # Keep keys stable: used for log tokens and iteration order.
  # If you add a new planner language, add it to the JSON manifest and update
  # any consumers that depend on the key set.
} // (builtins.fromJSON (builtins.readFile ../../lib/dev-override-envs.json))


