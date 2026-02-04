def normalize_build_tags(tags):
    """
    Return a deterministically sorted list of unique, lower-cased build tags.
    Non-string entries are ignored.
    """
    unique = {}
    for t in tags or []:
        if not isinstance(t, str):
            continue
        unique[t.lower()] = True
    return sorted(unique.keys())


def append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled):
    """
    Append Go tuple labels into kwargs['labels'] deterministically:
    - gotags:<comma-separated normalized tags>
    - goenv:GOOS=<lower>
    - goenv:GOARCH=<lower>
    - goenv:CGO_ENABLED=1|0 (when cgo_enabled is not None)
    """
    labels = kwargs.pop("labels", [])
    extra = []
    norm_tags = normalize_build_tags(build_tags)
    if len(norm_tags) > 0:
        extra.append("gotags:" + ",".join(norm_tags))
    if isinstance(goos, str) and goos != "":
        extra.append("goenv:GOOS=" + goos.lower())
    if isinstance(goarch, str) and goarch != "":
        extra.append("goenv:GOARCH=" + goarch.lower())
    if cgo_enabled != None:
        extra.append("goenv:CGO_ENABLED=" + ("1" if bool(cgo_enabled) else "0"))
    kwargs["labels"] = labels + extra


