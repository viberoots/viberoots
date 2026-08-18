VERIFY_ISOLATED_LABEL = "verify:isolated"

ISOLATED_TESTS = {
    "build-tools/tools/tests/dev/dogfood-current-layout.test.ts": True,
    "build-tools/tools/tests/dev/pnpm-fixed-store.native-reconcile.integration.test.ts": True,
    "build-tools/tools/tests/dev/pnpm-store.exact-platform-filter.integration.test.ts": True,
    "build-tools/tools/tests/dev/verify.orphan-owned-process-cleanup.test.ts": True,
    "build-tools/tools/tests/dev/verify.temp-repo-buck-cleanup.scoped.test.ts": True,
    "build-tools/tools/tests/lib/buck-daemon-cleanup.interrupted.test.ts": True,
    "build-tools/tools/tests/lib/buck-daemon-cleanup.non-disruptive.test.ts": True,
    "build-tools/tools/tests/lib/buck-daemon-cleanup.uninterrupted.test.ts": True,
    "build-tools/tools/tests/node/node.wasm-stage-inline.mixed-producer-labels.test.ts": True,
    "build-tools/tools/tests/rust/rust.cargo-entrypoints.read-only.test.ts": True,
    "build-tools/tools/tests/rust/rust.native-build.rejects-cross-root-deps.test.ts": True,
    "build-tools/tools/tests/rust/rust.tauri-composition.behavior.test.ts": True,
    "build-tools/tools/tests/rust/rust.tauri-scaffold-flake.lifecycle.test.ts": True,
    "build-tools/tools/tests/scaffolding/node-go-addon.runtime.e2e.test.ts": True,
    "build-tools/tools/tests/scaffolding/rust-shapes.scaffold-lifecycle.test.ts": True,
    "build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts": True,
    "build-tools/tools/tests/verify/project-enforcement-freshness.integration.test.ts": True,
    "build-tools/tools/tests/viberoots/fresh-clone-post-clone-fail-closed.test.ts": True,
    "build-tools/tools/tests/viberoots/fresh-clone-post-clone-pnpm-stale.test.ts": True,
    "build-tools/tools/tests/viberoots/fresh-clone-post-clone.test.ts": True,
    "build-tools/tools/tests/viberoots/remote-consumer-fixture.test.ts": True,
}

def isolated_test_convention_for_script(path):
    if ISOLATED_TESTS.get(path, False):
        return {
            "labels": [VERIFY_ISOLATED_LABEL],
        }
    return None
