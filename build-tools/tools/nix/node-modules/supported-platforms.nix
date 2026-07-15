{ }:
let
  platforms = [
    { system = "aarch64-darwin"; os = "darwin"; cpu = "arm64"; }
    { system = "aarch64-linux"; os = "linux"; cpu = "arm64"; libc = "glibc"; }
    { system = "x86_64-linux"; os = "linux"; cpu = "x64"; libc = "glibc"; }
  ];
  markerFor = platform: libcs: builtins.concatStringsSep "\n" ([
    "supportedArchitectures:"
    "  os:"
    "    - ${platform.os}"
    "  cpu:"
    "    - ${platform.cpu}"
  ] ++ (if builtins.length libcs > 0 then [
    "  libc:"
  ] ++ map (libc: "    - ${libc}") libcs else [ ])) + "\n";
  exactMarkerFor = platform: markerFor platform (if platform ? libc then [ platform.libc ] else [ ]);
  # pnpm 11.5.3 skips libc filtering when detect-libc reports unknown on Darwin.
  # Retain both Linux libc variants in the universal FOD so Darwin and Linux
  # builders produce one hash. Supported Nix systems remain the glibc tuples above.
  universalMarkerFor = platform: markerFor platform (
    if platform.os == "linux" then [ "glibc" "musl" ] else [ ]
  );
  platformForSystem = system:
    let matches = builtins.filter (platform: platform.system == system) platforms;
    in if builtins.length matches == 1
       then builtins.head matches
       else throw "unsupported Nix system for pnpm node_modules: ${system}";
in {
  inherit platforms markerFor platformForSystem;
  universalMarkers = map universalMarkerFor platforms;
  markerForSystem = system: exactMarkerFor (platformForSystem system);
}
