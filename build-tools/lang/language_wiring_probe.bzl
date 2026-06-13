load("@prelude//:rules.bzl", "genrule")
load("@viberoots//build-tools/lang:language_wiring.bzl", "prepare_language_wiring")

def language_wiring_mutation_probe(name, lang, kind, lockfile_label = None):
    """
    Probe helper for tests. Asserts prepare_language_wiring does not mutate the input dict.
    """
    kw = {"labels": ["probe:language_wiring"]}
    def _has_prefix(xs, prefix):
        for x in xs:
            if isinstance(x, str) and x.startswith(prefix):
                return True
        return False
    pre_labels = kw.get("labels", []) or []
    pre = {
        "srcs": "srcs" in kw,
        "labels_has_patch_scope": _has_prefix(pre_labels, "patch_scope:"),
        "labels_has_lockfile": _has_prefix(pre_labels, "lockfile:"),
    }
    _ = prepare_language_wiring(
        name = name,
        kwargs = kw,
        deps = [],
        lang = lang,
        kind = kind,
        labels = [],
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = {},
        wiring = "non_genrule",
    )
    post_labels = kw.get("labels", []) or []
    post = {
        "srcs": "srcs" in kw,
        "labels_has_patch_scope": _has_prefix(post_labels, "patch_scope:"),
        "labels_has_lockfile": _has_prefix(post_labels, "lockfile:"),
    }

    out = []
    for k in ["srcs", "labels_has_patch_scope", "labels_has_lockfile"]:
        out.append("pre:%s:%s" % (k, "true" if pre[k] else "false"))
        out.append("post:%s:%s" % (k, "true" if post[k] else "false"))

    genrule(
        name = name,
        srcs = [],
        out = name + ".items.txt",
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(out),
        labels = ["kind:probe"],
    )

__all__ = [
    "language_wiring_mutation_probe",
]
