{ cargoLock }:
let
  packages = (builtins.fromTOML (builtins.readFile cargoLock)).package or [];
  inventory = map (package: {
    name = package.name;
    version = package.version;
    source = package.source or "workspace";
    checksum = package.checksum or "";
    dependencies = builtins.sort (a: b: a < b) (package.dependencies or []);
  }) packages;
in
builtins.sort (
  a: b:
  "${a.name}:${a.version}:${a.source}" < "${b.name}:${b.version}:${b.source}"
) inventory
