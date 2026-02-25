load("//build-tools/lang:defs_common.bzl", "dedupe_preserve")
load(
    "//build-tools/tools/tests:template_taxonomy_adapter.bzl",
    "CANONICAL_TEMPLATE_ID_SET",
    "canonical_template_id",
)

TEMPLATE_CLASSIFICATION_LABELS = [
    "template:smoke",
    "template:contract",
    "template:shared",
]

_TEMPLATE_TEST_CONVENTIONS = {
    "build-tools/tools/tests/scaffolding/smoke.lib-readme.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/go/lib"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/smoke.cli-readme.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/go/cli"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/go-lib.scaffold-and-build.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/go/lib"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/go-cli.scaffold-and-build.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/go/cli"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/cpp.lib.shape-and-build.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/cpp/lib"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/node-lib.nix-node-test.with-tests-pass.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/lib"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/node-cli.nix-node-test.with-tests-pass.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/cli"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp.scaffold-and-build.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/webapp-static"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr.scaffold-contract-and-runtime-smoke.test.ts": {
        "template_roots": [
            "build-tools/tools/scaffolding/templates/ts/webapp-ssr-express",
            "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next",
        ],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr.scaffold-and-build.test.ts": {
        "template_roots": [
            "build-tools/tools/scaffolding/templates/ts/webapp-ssr-express",
            "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next",
        ],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr.express-contracts.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/webapp-ssr-express"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr.next-contracts.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/webapp-ssr-next"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr-vite.baseline-contract.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-runtime-contract.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/webapp-ssr-vite.runnable-contracts.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/python-lib.scaffold-files.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/python/lib"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/python-app.scaffold-files.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/python/app"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/python-wasm-app.scaffold-smoke.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/python/wasm-app"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/scaffolding/scaf-language-new.manifest-write.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/language/kit"],
        "classification": "template:contract",
    },
    "build-tools/tools/tests/scaffolding/lang-kit.scaffold-smoke.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/language/kit"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/ts-cpp-go-wasm/scaffolding.scaf-new-dry-run.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/go-cpp-lib"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/ts-cpp-go-wasm/scaffolding.wasm-app.scaffold-smoke.test.ts": {
        "template_roots": ["build-tools/tools/scaffolding/templates/ts/wasm-app"],
        "classification": "template:smoke",
    },
    "build-tools/tools/tests/ts-cpp-go-wasm/scaffolding.templates-exist.test.ts": {
        "template_roots": [
            "build-tools/tools/scaffolding/templates/ts/go-cpp-lib",
            "build-tools/tools/scaffolding/templates/ts/wasm-app",
        ],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/ts-command-path.tooling-contract.test.ts": {
        "template_roots": [
            "build-tools/tools/scaffolding/templates/ts/lib",
            "build-tools/tools/scaffolding/templates/ts/cli",
            "build-tools/tools/scaffolding/templates/ts/webapp-static",
        ],
        "classification": "template:shared",
    },
    "build-tools/tools/tests/scaffolding/ts-command-path.docs-contract.test.ts": {
        "template_roots": [
            "build-tools/tools/scaffolding/templates/ts/lib",
            "build-tools/tools/scaffolding/templates/ts/cli",
            "build-tools/tools/scaffolding/templates/ts/webapp-static",
            "build-tools/tools/scaffolding/templates/ts/cpp-addon",
        ],
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

def _template_id_from_root(template_root):
    if not isinstance(template_root, str):
        fail("template convention root must be a string path")
    normalized = template_root.strip("/")
    prefix = "build-tools/tools/scaffolding/templates/"
    if not normalized.startswith(prefix):
        fail("template convention root must start with %s: %s" % (prefix, template_root))
    rel = normalized[len(prefix):]
    parts = rel.split("/")
    if len(parts) != 2:
        fail("template convention root must be templates/<language>/<template>: %s" % template_root)
    language = parts[0]
    template = parts[1]
    if language == "" or template == "":
        fail("template convention root has empty language/template segment: %s" % template_root)
    template_id = canonical_template_id(language, template)
    if not CANONICAL_TEMPLATE_ID_SET.get(template_id, False):
        fail("template convention references unknown canonical id: %s" % template_id)
    return template_id

def _template_ids_from_roots(template_roots):
    out = []
    for root in template_roots:
        out.append(_template_id_from_root(root))
    return dedupe_preserve(out)

def template_convention_for_script(path):
    c = _TEMPLATE_TEST_CONVENTIONS.get(path)
    if c == None:
        return None
    template_ids = _template_ids_from_roots(c.get("template_roots", []))
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

