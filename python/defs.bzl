load("@prelude//:rules.bzl", "python_binary", "python_library", "python_test", "genrule")
load(
    "//lang:defs_common.bzl",
    "append_nixpkg_labels",
    "prepare_importer_non_genrule_wiring",
    "stamp_wasm_variant",
)
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//lang:sanitize.bzl", "sanitize_name")

def nix_python_library(name, lockfile_label = None, deps = [], **kwargs):
    """
    Thin macro over python_library that:
    - appends nixpkg labels for native deps
    - delegates importer-scoped wiring (lockfile enforcement, stamping, patch inputs, provider edges)
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "lib",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_library(deps = wiring.deps, **wiring.kwargs)

def nix_python_binary(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for binaries.
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    if "srcs" in kwargs:
        fail("nix_python_binary does not accept srcs; use main/main_module + deps instead")
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "bin",
        lockfile_label = lockfile_label,
        # python_binary does not accept srcs. For importer-local patch invalidation we use an internal
        # helper python_library that depends on a genrule hashing the patch contents into a tiny
        # generated .py file. This makes patch edits affect the binary's deps and therefore rebuilds,
        # without shipping patch files as runtime resources.
        patch_into = None,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )

    # If no patches exist, skip helper targets to avoid extra actions. native.glob tracks future
    # additions so introducing a patch later will still update the build graph deterministically.
    patch_files = native.glob(["patches/python/*.patch"])
    extra_deps = []
    if len(patch_files) > 0:
        hash_rule = sanitize_name(name + "__patch_inputs_hash")
        hash_out = hash_rule + ".py"
        genrule(
            name = hash_rule,
            srcs = patch_files,
            out = hash_out,
            cmd = """set -euo pipefail
if [ -z "${SRCS:-}" ]; then
  echo "nix_python_binary patch hash: SRCS is empty (unexpected)" >&2
  exit 2
fi
python3 - $SRCS <<'PY' > "$OUT"
import hashlib
import sys

paths = sys.argv[1:]
h = hashlib.sha256()
for p in sorted(paths):
    with open(p, "rb") as f:
        h.update(f.read())
    h.update(b"\\0")

print("# generated: python importer-local patch invalidation")
print("PATCH_INPUTS_SHA256 = %r" % h.hexdigest())
PY
""",
        )
        patch_lib = sanitize_name(name + "__patch_inputs")
        python_library(
            name = patch_lib,
            srcs = [":" + hash_rule],
            labels = wiring.kwargs.get("labels", []),
        )
        extra_deps = [":" + patch_lib]

    python_binary(deps = wiring.deps + extra_deps, **wiring.kwargs)

def nix_python_test(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for tests.
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "test",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_test(deps = wiring.deps, **wiring.kwargs)

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI app stamp: uses python_* rules for Buck semantics but marks kind:wasm for the planner.
    """
    kw = dict(kwargs)
    stamp_wasm_variant(kw, "python", "wasi")
    nixpkg_deps = kw.pop("nixpkg_deps", [])
    append_nixpkg_labels(kw, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kw,
        deps = deps,
        lang = "python",
        kind = "wasm",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_library(deps = wiring.deps, **wiring.kwargs)

def nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI lib stamp: emits a reusable overlay (planner builds via pyWasmLib).
    """
    kw = dict(kwargs)
    stamp_wasm_variant(kw, "python", "wasi")
    nixpkg_deps = kw.pop("nixpkg_deps", [])
    append_nixpkg_labels(kw, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kw,
        deps = deps,
        lang = "python",
        kind = "wasm",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_library(deps = wiring.deps, **wiring.kwargs)


