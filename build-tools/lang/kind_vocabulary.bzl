"""
kind:* vocabulary contract (Starlark side).

This is a shared cross-language contract surface. Keep it in parity with:
- `build-tools/tools/lib/kind-vocabulary.ts`
- `build-tools/tools/tests/lang/kind-vocabulary.parity.test.ts`
"""

load("@viberoots//build-tools/lang:labels_file.bzl", "labels_file")

ALLOWED_KIND_VALUES = [
    "addon",
    "app",
    "bin",
    "bundle",
    "carchive",
    "deployment",
    "gen",
    "headers",
    "lib",
    "migration-bundle",
    "migrations",
    "packaging",
    "pyext",
    "pyext_wasm",
    "probe",
    "test",
    "wasm",
]

def is_allowed_kind_value(kind):
    return kind in ALLOWED_KIND_VALUES

def kind_vocabulary_probe(name):
    labels_file(
        name = name,
        labels = ALLOWED_KIND_VALUES,
        out = name + ".kind-values.txt",
    )

__all__ = [
    "ALLOWED_KIND_VALUES",
    "is_allowed_kind_value",
    "kind_vocabulary_probe",
]


