load("@viberoots//build-tools/lang:collections.bzl", "dedupe_preserve")

_REQUIRED_PREFIX = "node_patch_required:"
_OPTIONAL_PREFIX = "node_patch_optional:"
_SUPPORTED_OPTION_KEYS = ["optional"]

def _basename_posix(path):
    parts = [p for p in path.split("/") if p != ""]
    if len(parts) == 0:
        return ""
    return parts[-1]

def _decode_patch_filename(filename):
    if not isinstance(filename, str) or not filename.endswith(".patch"):
        return None
    base = filename[:-len(".patch")]
    at = base.rfind("@")
    if at <= 0 or at == len(base) - 1:
        return None
    raw_name = base[:at]
    version = base[at + 1:]
    name = raw_name.replace("__", "/")
    return ("%s@%s" % (name, version)).lower()

def _infer_patch_ids():
    all_patches = native.glob(["**/*.patch"])
    out = []
    for rel in sorted([p for p in all_patches if p.startswith("patches/node/") and p.find("/", len("patches/node/")) == -1]):
        key = _decode_patch_filename(_basename_posix(rel))
        if key == None:
            continue
        out.append(key)
    return dedupe_preserve(out)

def _validate_patch_options(patch_options, inferred_ids):
    if patch_options == None:
        return {}, []
    if not isinstance(patch_options, dict):
        fail("patch_options must be a dict of '<name>@<version>' -> {'optional': bool}")
    inferred_set = {k: True for k in inferred_ids}
    normalized = {}
    stale_optional_warn_ids = []
    for raw_key, raw_opts in patch_options.items():
        if not isinstance(raw_key, str) or raw_key == "":
            fail("patch_options keys must be non-empty strings; got: %s" % type(raw_key))
        key = raw_key.lower()
        if not isinstance(raw_opts, dict):
            fail("patch_options['%s'] must be a dict; got: %s" % (raw_key, type(raw_opts)))
        for opt_key in raw_opts.keys():
            if opt_key not in _SUPPORTED_OPTION_KEYS:
                fail("patch_options['%s'] has unknown option key '%s'; supported keys: %s" % (raw_key, opt_key, _SUPPORTED_OPTION_KEYS))
        optional_val = raw_opts.get("optional", False)
        if not isinstance(optional_val, bool):
            fail("patch_options['%s']['optional'] must be bool; got: %s" % (raw_key, type(optional_val)))
        if key not in inferred_set:
            if optional_val:
                stale_optional_warn_ids.append(key)
                continue
            fail("patch_options contains unknown patch id '%s'; expected one of inferred ids: %s" % (raw_key, inferred_ids))
        normalized[key] = {"optional": optional_val}
    return normalized, dedupe_preserve(sorted(stale_optional_warn_ids))

def apply_node_patch_requirement_labels(kwargs, patch_options = None):
    if kwargs == None:
        return struct(required_ids = [], optional_ids = [])
    labels = kwargs.get("labels", [])
    if not isinstance(labels, list):
        labels = []
    inferred_ids = _infer_patch_ids()
    normalized_opts, stale_optional_warn_ids = _validate_patch_options(patch_options, inferred_ids)
    required_ids = []
    optional_ids = []
    for patch_id in inferred_ids:
        opts = normalized_opts.get(patch_id, {})
        if opts.get("optional", False):
            optional_ids.append(patch_id)
        else:
            required_ids.append(patch_id)
    req_labels = [_REQUIRED_PREFIX + pid for pid in required_ids]
    opt_labels = [_OPTIONAL_PREFIX + pid for pid in optional_ids]
    kwargs["labels"] = dedupe_preserve(labels + req_labels + opt_labels)
    if len(stale_optional_warn_ids) > 0:
        print("WARN: stale optional patch_options ids ignored for //%s: %s" % (native.package_name(), stale_optional_warn_ids))
    return struct(
        required_ids = required_ids,
        optional_ids = optional_ids,
    )
