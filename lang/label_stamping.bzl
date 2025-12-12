load("//lang:collections.bzl", "dedupe_preserve")
load("//lang:global_inputs.bzl", "global_nix_inputs")

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

def _labels_file_impl(ctx):
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, "\n".join(ctx.attrs.labels) + "\n")
    return [DefaultInfo(default_output = out)]

labels_file = rule(
    impl = _labels_file_impl,
    attrs = {
        "labels": attrs.list(attrs.string(), default = []),
        "out": attrs.string(),
    },
)

def wasm_labels_probe(name, lang, variant, labels = []):
    kw = { "labels": (labels or []) }
    stamp_wasm_variant(kw, lang, variant)
    labels_file(
        name = name,
        labels = kw.get("labels", []),
        out = name + ".labels.txt",
    )


