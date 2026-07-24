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
  unsupported = builtins.filter
    (source: !(builtins.elem source policy.supported_lock_sources))
    sources;
in
if unsupported == [] then true else
  builtins.throw
    "Rust Cargo.lock contains unsupported dependency source: ${builtins.head unsupported}"
