load("//tools/buck:zx_test.bzl", "zx_test")

def _name_from(path: str) -> str:
    # Strip the tools/tests/ prefix and extension, flatten to underscores.
    n = path
    if n.startswith("tools/tests/"):
        n = n[len("tools/tests/"):]
    if n.endswith(".ts"):
        n = n[:-3]
    # Drop trailing ".test" segment if present to preserve legacy target names
    if n.endswith(".test"):
        n = n[:-5]
    # Normalize separators/hyphens to underscores for stable legacy labels
    n = n.replace("/", "_").replace(".", "_").replace("-", "_")
    # Buck target names must be reasonably short; keep as-is for now.
    return n

def auto_zx_tests(root = "tools/tests", patterns = ["**/*.test.ts"]):
    files = []
    for p in patterns:
        for f in native.glob(["%s/%s" % (root, p)], exclude=["**/node_modules/**", "**/.direnv/**"]):
            files.append(f)
    for f in sorted(files):
        name = _name_from(f)
        zx_test(
            name = name,
            script = f,
            out = name + ".stamp",
        )


