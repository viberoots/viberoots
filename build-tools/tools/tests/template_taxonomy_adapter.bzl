# GENERATED FILE — DO NOT EDIT.
# Rendered from build-tools/tools/scaffolding/template-manifest.json

CANONICAL_TEMPLATE_IDS = [
    "cpp/cli",
    "cpp/lib",
    "deployment/cloudflare-pages",
    "deployment/opentofu-foundation",
    "deployment/opentofu-provisioner",
    "deployment/service",
    "deployment/shared",
    "deployment/vercel-next",
    "go/cli",
    "go/lib",
    "language/kit",
    "python/app",
    "python/lib",
    "python/wasm-app",
    "python/wasm-lib",
    "ts/cli",
    "ts/cpp-addon",
    "ts/go-addon",
    "ts/go-cpp-lib",
    "ts/lib",
    "ts/service",
    "ts/wasm-app",
    "ts/wasm-inline",
    "ts/wasm-linking-app",
    "ts/webapp-ssr-next",
    "ts/webapp-ssr-vite",
    "ts/webapp-static",
    "ts/webapp-static-pwa",
]

CANONICAL_TEMPLATE_ID_SET = {template_id: True for template_id in CANONICAL_TEMPLATE_IDS}

def canonical_template_id(language, template):
    template_id = "%s/%s" % (language, template)
    if not CANONICAL_TEMPLATE_ID_SET.get(template_id, False):
        fail("unknown canonical template id: %s" % template_id)
    return template_id
