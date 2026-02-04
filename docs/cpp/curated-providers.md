## Using curated nixpkgs C++ providers

These examples show how to consume curated providers such as `pkgs.zlib` and `pkgs.openssl` with no local header shims; include and link flags are resolved by the Nix templates.

### C++ test including zlib

```starlark
# apps/demo/TARGETS
load("//cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_zlib_gtest",
    srcs = ["tests/demo_zlib_gtest.cpp"],
    deps = [
        "//third_party/providers:nix_pkgs_googletest",
    ],
)
```

```cpp
// apps/demo/tests/demo_zlib_gtest.cpp
#include <gtest/gtest.h>
#include <zlib.h>

TEST(Demo, ZlibSmoke) {
  EXPECT_EQ(Z_OK, Z_OK);
}
```

### C++ test including OpenSSL

```starlark
# apps/demo/TARGETS
load("//cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_openssl_gtest",
    srcs = ["tests/demo_openssl_gtest.cpp"],
    deps = [
        "//third_party/providers:nix_pkgs_googletest",
        "//third_party/providers:nix_pkgs_openssl",
    ],
)
```

```cpp
// apps/demo/tests/demo_openssl_gtest.cpp
#include <gtest/gtest.h>
#include <openssl/ssl.h>

TEST(Demo, OpenSSLSmoke) {
  EXPECT_EQ(SSL_VERIFY_NONE, SSL_VERIFY_NONE);
}
```

### Notes

- Naming: `//third_party/providers:nix_<attr>` where `<attr>` is the nixpkgs attribute path normalized and with non‑alnum to `_` (e.g., `pkgs.openssl` → `nix_pkgs_openssl`). Naming is canonical and shared with scripts via `build-tools/tools/lib/providers.ts`.
- Determinism: the planner collects `nixpkg:*` labels from deps and passes them to `build-tools/tools/nix/templates/cpp.nix`, which resolves include and library paths from nixpkgs; no paths are hard-coded in Starlark.
- Linking: GoogleTest linking is auto-detected by the template when `pkgs.googletest` is present; other libraries only need to be listed as provider deps.
- Normalization contract: `nixpkg:` labels are normalized consistently across Starlark/TypeScript/Nix; the parity matrix lives at `build-tools/tools/tests/normalization-parity.test.ts`.
