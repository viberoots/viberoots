load("@viberoots//build-tools/lang:labels_file.bzl", "labels_file")
load("@viberoots//build-tools/lang:patch_inputs.bzl", "default_package_patch_dirs")
load("@viberoots//build-tools/lang:nixpkg_labels.bzl", "append_nixpkg_labels", "normalize_nix_attr")

_DEFAULT_NIXPKGS_PROFILE = "default"
_RAW_FLAKE_MARKERS = ["github:", "git+https://", "git+ssh://", "path:", "tarball:", "flake:"]
_HEX = "0123456789abcdef"

def _looks_like_raw_commit(value):
    s = str(value).strip().lower()
    if len(s) != 40:
        return False
    for i in range(len(s)):
        ch = s[i]
        if ch not in _HEX:
            return False
    return True

def _reject_raw_source_value(context, value):
    s = str(value).strip().lower()
    if _looks_like_raw_commit(s):
        fail("%s must name a nixpkgs profile, not a raw commit" % context)
    for marker in _RAW_FLAKE_MARKERS:
        if marker in s:
            fail("%s must name a nixpkgs profile, not a raw flake URL" % context)

def pop_nixpkgs_profile(kwargs):
    raw = kwargs.pop("nixpkgs_profile", _DEFAULT_NIXPKGS_PROFILE)
    if not isinstance(raw, str):
        fail("nixpkgs_profile must be a string")
    profile = raw.strip()
    if profile == "":
        fail("nixpkgs_profile must be a non-empty string")
    _reject_raw_source_value("nixpkgs_profile", profile)
    return profile

def _validate_pin_entry(attr, raw_entry):
    if not isinstance(raw_entry, dict):
        fail("nixpkg_pins[%s] must be a dict" % attr)
    profile = raw_entry.get("nixpkgs_profile")
    if not isinstance(profile, str):
        fail("nixpkg_pins[%s].nixpkgs_profile must be a string" % attr)
    profile = profile.strip()
    if profile == "":
        fail("nixpkg_pins[%s].nixpkgs_profile must be a non-empty string" % attr)
    _reject_raw_source_value("nixpkg_pins[%s].nixpkgs_profile" % attr, profile)
    rationale = raw_entry.get("rationale")
    if not isinstance(rationale, str) or rationale.strip() == "":
        fail("nixpkg_pins[%s].rationale must be a non-empty string" % attr)
    return {
        "nixpkgs_profile": profile,
        "rationale": rationale.strip(),
    }

def pop_nixpkg_pins(kwargs):
    raw = kwargs.pop("nixpkg_pins", {})
    if not isinstance(raw, dict):
        fail("nixpkg_pins must be a dict")
    out = {}
    for attr, entry in raw.items():
        if not isinstance(attr, str):
            fail("nixpkg_pins keys must be nixpkgs attr strings")
        normalized = normalize_nix_attr(attr)
        if normalized == "":
            fail("nixpkg_pins contains an empty nixpkgs attr key")
        if normalized in out:
            fail("duplicate normalized nixpkg_pins key %s" % normalized)
        out[normalized] = _validate_pin_entry(normalized, entry)
    return out

def normalize_source_selection_attrs(kwargs):
    nixpkgs_profile = pop_nixpkgs_profile(kwargs)
    nixpkg_pins = pop_nixpkg_pins(kwargs)
    kwargs["nixpkgs_profile"] = nixpkgs_profile
    kwargs["nixpkg_pins"] = nixpkg_pins
    return struct(
        nixpkgs_profile = nixpkgs_profile,
        nixpkg_pins = nixpkg_pins,
    )

def pop_local_patch_dirs(kwargs, lang):
    """
    Pop `local_patch_dirs` from `kwargs` and return a list of patch directories.

    Behavior is tolerant and deterministic:
    - If the caller provides a list, it is returned as-is.
    - Any non-list shape is ignored and the language default is returned.
    """
    default_dirs = default_package_patch_dirs(lang)
    raw = kwargs.pop("local_patch_dirs", default_dirs)
    if isinstance(raw, list):
        return raw
    return default_dirs

def pop_nixpkg_deps(kwargs):
    """
    Pop `nixpkg_deps` from `kwargs` and return a list of strings.

    Behavior is tolerant and deterministic:
    - If the caller provides a list, it is returned as-is (individual items are validated later).
    - Any non-list shape is ignored and treated as empty.
    """
    raw = kwargs.pop("nixpkg_deps", [])
    if isinstance(raw, list):
        return raw
    return []

def pop_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True):
    """
    Shared macro helper:
    - pops `local_patch_dirs` (default: `default_package_patch_dirs(lang)`)
    - pops `nixpkg_deps` (list-of-strings or empty; non-list ignored deterministically)
    - optionally appends normalized `nixpkg:` labels via `append_nixpkg_labels(...)`

    Returns a struct: { local_patch_dirs, nixpkg_deps }.
    """
    local_patch_dirs = pop_local_patch_dirs(kwargs, lang)
    nixpkg_deps = pop_nixpkg_deps(kwargs)
    source_selection = normalize_source_selection_attrs(kwargs)
    if append_labels:
        append_nixpkg_labels(kwargs, nixpkg_deps)
    return struct(
        local_patch_dirs = local_patch_dirs,
        nixpkg_deps = nixpkg_deps,
        nixpkgs_profile = source_selection.nixpkgs_profile,
        nixpkg_pins = source_selection.nixpkg_pins,
    )

def extract_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True):
    """
    Non-mutating variant of pop_package_local_patch_dirs_and_nixpkg_deps.

    Returns a struct:
      - kwargs: a new dict with local source-selection attrs normalized
      - local_patch_dirs
      - nixpkg_deps
      - nixpkgs_profile
      - nixpkg_pins
    """
    src = kwargs if isinstance(kwargs, dict) else {}
    kw = dict(src)
    info = pop_package_local_patch_dirs_and_nixpkg_deps(kw, lang, append_labels = append_labels)
    return struct(
        kwargs = kw,
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
        nixpkgs_profile = info.nixpkgs_profile,
        nixpkg_pins = info.nixpkg_pins,
    )

def macro_kwargs_probe(
        name,
        lang,
        local_patch_dirs = None,
        nixpkg_deps = None,
        nixpkgs_profile = None,
        nixpkg_pins = None,
        append_labels = True):
    """
    Probe helper for tests. Writes a newline-delimited file of:
    - patch_dir:<dir> (in returned order)
    - nixpkg_dep:<raw> (in returned order)
    - label:<label> (post-append_nixpkg_labels, if enabled)
    """
    kw = {}
    if local_patch_dirs != None:
        kw["local_patch_dirs"] = local_patch_dirs
    if nixpkg_deps != None:
        kw["nixpkg_deps"] = nixpkg_deps
    if nixpkgs_profile != None:
        kw["nixpkgs_profile"] = nixpkgs_profile
    if nixpkg_pins != None:
        kw["nixpkg_pins"] = nixpkg_pins
    info = pop_package_local_patch_dirs_and_nixpkg_deps(kw, lang, append_labels = append_labels)
    out = []
    for d in info.local_patch_dirs:
        out.append("patch_dir:%s" % d)
    for a in info.nixpkg_deps:
        out.append("nixpkg_dep:%s" % a)
    out.append("nixpkgs_profile:%s" % info.nixpkgs_profile)
    out.append("nixpkg_pins:%s" % len(info.nixpkg_pins))
    if append_labels:
        for l in (kw.get("labels", []) or []):
            out.append("label:%s" % l)
    labels_file(
        name = name,
        labels = out,
        out = name + ".items.txt",
    )

__all__ = [
    "pop_local_patch_dirs",
    "pop_nixpkg_deps",
    "pop_nixpkgs_profile",
    "pop_nixpkg_pins",
    "normalize_source_selection_attrs",
    "pop_package_local_patch_dirs_and_nixpkg_deps",
    "extract_package_local_patch_dirs_and_nixpkg_deps",
    "macro_kwargs_probe",
]
