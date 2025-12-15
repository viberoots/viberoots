load("//lang:collections.bzl", "dedupe_preserve")
load("//lang:sanitize.bzl", "sanitize_name")
load("//lang:labels_file.bzl", "labels_file")

def _unique_dict_key(dst_to_src, desired):
    if not isinstance(dst_to_src, dict):
        return desired
    if desired not in dst_to_src:
        return desired
    for i in range(1, 1000):
        k = "%s__%d" % (desired, i)
        if k not in dst_to_src:
            return k
    fail("attach_items_dict_safe: failed to find unique synthetic key after 999 attempts: %s" % desired)

def _normalize_key_prefix(key_prefix, default):
    if not isinstance(key_prefix, str) or key_prefix == "":
        return default
    return key_prefix

def attach_items_dict_safe(dst_to_src, items, key_prefix):
    """
    Attach a list of items into a dict-shaped input attribute (dest -> source).

    - Stable keying: "<key_prefix>/<sanitize_name(item)>"
    - Collision handling: appends "__<n>" deterministically, never overwrites existing keys.
    - Deterministic order: items are sorted before attachment.
    """
    if not isinstance(dst_to_src, dict):
        return dst_to_src
    if items == None:
        return dst_to_src

    kp = _normalize_key_prefix(key_prefix, "__items__")
    filtered = []
    for x in items:
        if isinstance(x, str) and x != "":
            filtered.append(x)
    for x in dedupe_preserve(sorted(filtered)):
        desired = "%s/%s" % (kp, sanitize_name(x))
        # Idempotent: keep existing mapping when it already points at the same source.
        if desired in dst_to_src and dst_to_src.get(desired) == x:
            continue
        dst_to_src[_unique_dict_key(dst_to_src, desired)] = x
    return dst_to_src

def attach_items_into_kwargs_dict_safe(kwargs, items, into = "srcs", key_prefix = "__items__"):
    """
    Attach items into kwargs[into] when it is dict-shaped.
    Unknown/non-dict shapes are left unchanged.
    """
    if kwargs == None or not isinstance(kwargs, dict):
        return
    if not isinstance(into, str) or into == "":
        return
    existing = kwargs.get(into, None)
    if existing == None:
        return
    if not isinstance(existing, dict):
        return
    kwargs[into] = attach_items_dict_safe(existing, items, key_prefix)

def dict_items_probe(name, items, key_prefix, initial = None):
    """
    Test-only probe to materialize dict keys as an output artifact.
    """
    dst_to_src = {} if initial == None else (dict(initial) if isinstance(initial, dict) else {})
    attach_items_dict_safe(dst_to_src, items, key_prefix)
    labels_file(
        name = name,
        labels = sorted(dst_to_src.keys()),
        out = name + ".keys.txt",
    )


