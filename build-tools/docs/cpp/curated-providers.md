## Using Curated nixpkgs Dependencies from C++

These examples show how to consume curated nixpkgs dependencies such as `pkgs.zlib` and
`pkgs.openssl` with no local header shims. C++ targets declare these inputs with `nixpkg_deps`;
generated provider wiring and the Nix templates resolve include and link flags.

### C++ test including zlib

```starlark
# projects/apps/demo/TARGETS
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_zlib_gtest",
    srcs = ["tests/demo_zlib_gtest.cpp"],
    nixpkg_deps = [
        "pkgs.googletest",
        "pkgs.zlib",
    ],
)
```

```cpp
// projects/apps/demo/tests/demo_zlib_gtest.cpp
#include <gtest/gtest.h>
#include <zlib.h>

TEST(Demo, ZlibSmoke) {
  EXPECT_EQ(Z_OK, Z_OK);
}
```

### C++ test including OpenSSL

```starlark
# projects/apps/demo/TARGETS
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_openssl_gtest",
    srcs = ["tests/demo_openssl_gtest.cpp"],
    nixpkg_deps = [
        "pkgs.googletest",
        "pkgs.openssl",
    ],
)
```

```cpp
// projects/apps/demo/tests/demo_openssl_gtest.cpp
#include <gtest/gtest.h>
#include <openssl/ssl.h>

TEST(Demo, OpenSSLSmoke) {
  EXPECT_EQ(SSL_VERIFY_NONE, SSL_VERIFY_NONE);
}
```

### Notes

- Naming: use canonical nixpkgs attrs such as `pkgs.openssl` and `pkgs.zlib`; the macro stamps normalized `nixpkg:*` labels for downstream tooling.
- Determinism: the planner collects `nixpkg:*` labels, resolves them through the selected target's
  `nixpkgs_profile`, and passes packages to `build-tools/tools/nix/templates/cpp.nix`; no paths are
  hard-coded in Starlark.
- Source profiles: `nixpkgs_profile` moves the whole selected C++ target to a named registry
  profile, including compiler/stdenv and ordinary unpinned `nixpkg_deps`. `nixpkg_pins` can redirect
  specific declared attrs to another named profile with a per-pin rationale. The same resolver path
  covers C++ libraries, binaries, tests, wasm libraries, and C++ Node addons.
- Linking: GoogleTest linking is auto-detected by the template when `pkgs.googletest` is present; other libraries only need to be listed in `nixpkg_deps`.
- Normalization contract: `nixpkg:` labels are normalized consistently across Starlark/TypeScript/Nix; the parity matrix lives at `build-tools/tools/tests/normalization-parity.test.ts`.
