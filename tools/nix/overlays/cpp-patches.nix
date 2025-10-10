## Overlay for C++ package patches (nixpkgs)
#
# This overlay is intentionally empty by default. To patch a nixpkgs C/C++
# package, override the corresponding attribute here using applyPatches or
# overrideAttrs. Keep the list deterministic and sorted.
#
# Examples (uncomment and adapt):
#
# final: prev: let
#   inherit (final) lib;
#   apply = pkg: patches: final.applyPatches { inherit pkg patches; name = "cpp-patched-${pkg.pname or "pkg"}"; };
# in {
#   # Patch pkgs.zlib using files under patches/cpp/*.patch
#   # zlib = apply prev.zlib [ ../../../../patches/cpp/zlib-fix-build.patch ];
#
#   # Patch pkgs.openssl with multiple patches
#   # openssl = apply prev.openssl [ ../../../../patches/cpp/openssl-foo.patch ];
# }

final: prev: {
  # No-op overlay by default. Add patched attributes as shown above.
}

