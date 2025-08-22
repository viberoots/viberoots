# Buck2 test definitions for zx-based tests

# Declare tests as genrules that run zx scripts

genrule(
    name = "scaffolding_smoke",
    srcs = ["tools/tests/scaffolding-smoke.test.ts"],
    out = "scaffolding_smoke.stamp",
    cmd = "node tools/tests/scaffolding-smoke.test.ts && echo ok > $OUT",
    type = "test",
)

genrule(
    name = "templates_validate_spec",
    srcs = ["tools/tests/templates-validate.spec.ts"],
    out = "templates_validate_spec.stamp",
    cmd = "node tools/tests/templates-validate.spec.ts && echo ok > $OUT",
    type = "test",
)

genrule(
    name = "scaffolding_e2e",
    srcs = ["tools/tests/scaffolding-e2e.ts"],
    out = "scaffolding_e2e.stamp",
    cmd = "node tools/tests/scaffolding-e2e.ts && echo ok > $OUT",
    type = "test",
)
