{
  lockFile,
  policyFile ? ./cargo-source-policy.json,
}:
let
  policy = builtins.fromJSON (builtins.readFile policyFile);
  lock = builtins.fromTOML (builtins.readFile lockFile);
  packages = lock.package or [];
  sources = builtins.filter (source: source != null)
    (map (package: package.source or null) packages);
  hasPrefix = prefix: value:
    builtins.substring 0 (builtins.stringLength prefix) value == prefix;
  unsupported = builtins.filter
    (source:
      !(builtins.elem source policy.supported_lock_sources)
      && !(builtins.any (prefix: hasPrefix prefix source)
        (policy.supported_lock_source_prefixes or []))
      && builtins.match (policy.supported_git_source_pattern or "a^") source == null)
    sources;
in
if unsupported == [] then true else
  builtins.throw
    "Rust Cargo.lock contains unsupported dependency source: ${builtins.head unsupported}"
