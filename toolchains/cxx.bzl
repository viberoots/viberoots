load("@prelude//toolchains:cxx.bzl", _system_cxx_toolchain = "system_cxx_toolchain")

def system_cxx_toolchain(**kwargs):
    if "_cxx_tools_info" not in kwargs or not kwargs["_cxx_tools_info"]:
        kwargs["_cxx_tools_info"] = "prelude//toolchains/cxx/clang:path_clang_tools"
    return _system_cxx_toolchain(**kwargs)


