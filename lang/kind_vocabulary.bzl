"""
kind:* vocabulary contract (Starlark side).

This is a shared cross-language contract surface. Keep it in parity with:
- `tools/lib/kind-vocabulary.ts`
- `tools/tests/lang/kind-vocabulary.parity.test.ts`
"""

load("//lang:labels_file.bzl", "labels_file")

ALLOWED_KIND_VALUES = [
    "addon",
    "app",
    "bin",
    "bundle",
    "carchive",
    "gen",
    "headers",
    "lib",
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


