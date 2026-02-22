load("//build-tools/lang:defs_common.bzl", "dedupe_preserve")

TEMPLATE_CLASSIFICATION_LABELS = [
    "template:smoke",
    "template:contract",
    "template:shared",
]

_TEMPLATE_TEST_CONVENTIONS = {
    "build-tools/tools/tests/scaffolding/smoke.lib-readme.test.ts": {
        "template_ids": ["go/lib"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/smoke.cli-readme.test.ts": {
        "template_ids": ["go/cli"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/go-lib.scaffold-and-build.test.ts": {
        "template_ids": ["go/lib"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/go-cli.scaffold-and-build.test.ts": {
        "template_ids": ["go/cli"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/cpp.lib.shape-and-build.test.ts": {
        "template_ids": ["cpp/lib"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/node-lib.nix-node-test.with-tests-pass.test.ts": {
        "template_ids": ["ts/lib"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/node-cli.nix-node-test.with-tests-pass.test.ts": {
        "template_ids": ["ts/cli"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp.scaffold-and-build.test.ts": {
        "template_ids": ["ts/webapp-static"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr.scaffold-contract-and-runtime-smoke.test.ts": {
        "template_ids": ["ts/webapp-ssr-express", "ts/webapp-ssr-next"],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr.scaffold-and-build.test.ts": {
        "template_ids": ["ts/webapp-ssr-express", "ts/webapp-ssr-next"],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr.pr4-contracts.test.ts": {
        "template_ids": ["ts/webapp-ssr-express", "ts/webapp-ssr-next"],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/python-lib.scaffold-files.test.ts": {
        "template_ids": ["python/lib"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/python-app.scaffold-files.test.ts": {
        "template_ids": ["python/app"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/python-wasm-app.scaffold-smoke.test.ts": {
        "template_ids": ["python/wasm-app"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/scaf-language-new.manifest-write.test.ts": {
        "template_ids": ["language/kit"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/lang-kit.scaffold-smoke.test.ts": {
        "template_ids": ["language/kit"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/ts-cpp-go-wasm/pr8-scaffolding.scaf-new-dry-run.test.ts": {
        "template_ids": ["ts/go-cpp-lib"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/ts-cpp-go-wasm/pr8-scaffolding.wasm-app.scaffold-smoke.test.ts": {
        "template_ids": ["ts/wasm-app"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/ts-cpp-go-wasm/pr8-scaffolding.templates-exist.test.ts": {
        "template_ids": ["ts/go-cpp-lib", "ts/wasm-app"],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/pr3-ts-command-path.tooling-contract.test.ts": {
        "template_ids": ["ts/lib", "ts/cli", "ts/webapp-static"],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/pr3-ts-command-path.docs-contract.test.ts": {
        "template_ids": ["ts/lib", "ts/cli", "ts/webapp-static", "ts/cpp-addon"],
        "classification": "template:shared",
    },
}

TEMPLATE_SAFETY_FLOOR_SCRIPTS = [
    "build-tools/tools/tests/scaffolding/smoke.lib-readme.test.ts",
    "build-tools/tools/tests/scaffolding/smoke.cli-readme.test.ts",
    "build-tools/tools/tests/scaffolding/python-wasm-app.scaffold-smoke.test.ts",
]

def _is_template_id(value):
    if not isinstance(value, str):
        return False
    if not value.startswith("template:"):
        return False
    if value in TEMPLATE_CLASSIFICATION_LABELS:
        return False
    body = value[len("template:"):]
    if "/" not in body:
        return False
    parts = body.split("/")
    if len(parts) != 2:
        return False
    return parts[0] != "" and parts[1] != ""

def _template_label_for_id(template_id):
    return "template:%s" % template_id

def _template_glob_for_id(template_id):
    return "build-tools/tools/scaffolding/templates/%s/**" % template_id

def template_convention_for_script(path):
    c = _TEMPLATE_TEST_CONVENTIONS.get(path)
    if c == None:
        return None
    template_ids = c.get("template_ids", [])
    labels = [_template_label_for_id(tid) for tid in template_ids]
    classification = c.get("classification")
    if classification != None and classification != "":
        labels.append(classification)
    return {
        "labels": dedupe_preserve(labels),
        "template_input_globs": dedupe_preserve([_template_glob_for_id(tid) for tid in template_ids]),
    }

def validate_template_convention(path, labels, template_inputs):
    template_labels = [l for l in labels if isinstance(l, str) and l.startswith("template:")]
    if len(template_labels) == 0:
        return

    template_ids = [l for l in template_labels if _is_template_id(l)]
    if len(template_ids) == 0:
        fail("template-owned test must include at least one template:<language>/<template> label: %s" % path)

    class_labels = [l for l in labels if l in TEMPLATE_CLASSIFICATION_LABELS]
    if len(class_labels) != 1:
        fail("template-owned test must include exactly one classification label (%s): %s" % (", ".join(TEMPLATE_CLASSIFICATION_LABELS), path))

    if len(template_inputs) == 0:
        fail("template-owned test must declare template inputs: %s" % path)

