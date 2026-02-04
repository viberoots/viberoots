load("//build-tools/lang:collections.bzl", "dedupe_preserve")
load("//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("//build-tools/lang:lang_contracts.bzl", "patch_invalidation_strategy_for_lang")
load("//build-tools/lang:labels_file.bzl", "labels_file")

def normalize_labels(pkg, labels):
    if labels == None:
        return []
    if not isinstance(labels, list):
        fail("labels must be a list of string labels")
    out = []
    for l in labels:
        if not isinstance(l, str):
            fail("labels must be a list of string labels")
        if l.startswith(":"):
            out.append("//%s:%s" % (pkg, l[1:]))
        else:
            out.append(l)
    return out

def stamp_labels(kwargs, lang, kind = None):
    labels = kwargs.get("labels", []) or []
    stamps = ["lang:%s" % lang]
    if kind != None and isinstance(kind, str) and kind != "":
        stamps.append("kind:%s" % kind)
    kwargs["labels"] = dedupe_preserve(labels + stamps)

def stamp_global_nix_inputs(kwargs):
    labels = kwargs.get("labels", [])
    labels_list = labels if isinstance(labels, list) else []
    kwargs["labels"] = dedupe_preserve(labels_list + global_nix_inputs())

def stamp_wasm_variant(kwargs, lang, variant):
    if not isinstance(lang, str) or lang == "":
        return
    if not isinstance(variant, str) or variant == "":
        return
    labels = kwargs.get("labels", []) or []
    stamps = ["lang:%s" % lang, "kind:wasm", "wasm:%s" % variant]
    kwargs["labels"] = dedupe_preserve(labels + stamps)

def wasm_labels_probe(name, lang, variant, labels = []):
    kw = { "labels": (labels or []) }
    stamp_wasm_variant(kw, lang, variant)
    labels_file(
        name = name,
        labels = kw.get("labels", []),
        out = name + ".labels.txt",
    )

def stamp_patch_scope(kwargs, patch_scope):
    if not isinstance(patch_scope, str) or patch_scope == "":
        return
    labels = kwargs.get("labels", []) or []
    labels_list = labels if isinstance(labels, list) else []
    without_scope = [l for l in labels_list if not (isinstance(l, str) and l.startswith("patch_scope:"))]
    kwargs["labels"] = dedupe_preserve(without_scope + ["patch_scope:%s" % patch_scope])

def stamp_patch_scope_for_lang(kwargs, lang):
    s = patch_invalidation_strategy_for_lang(lang)
    if s == None:
        fail("unknown patch invalidation strategy for lang: %s" % lang)
    stamp_patch_scope(kwargs, s.patch_scope)


