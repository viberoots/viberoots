def validate_rust_runtime_args(build_py_deps, runtime_deps, behavior_probe):
    if not isinstance(build_py_deps, list) or not all([isinstance(dep, str) and dep != "" for dep in build_py_deps]):
        fail("rust target build_py_deps must be a list of non-empty Python package names")
    if not isinstance(runtime_deps, list):
        fail("rust target runtime_deps must be a list of labels")
    if not isinstance(behavior_probe, bool):
        fail("rust target behavior_probe must be a bool")
