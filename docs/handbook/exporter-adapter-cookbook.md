### Exporter adapter cookbook

This guide shows how to write and test an exporter adapter with minimal ceremony using helpers and manifest-driven discovery.

- **Auto-discovery**: put `tools/buck/exporter/lang/<id>.ts` next to `contract.ts`. It will be discovered automatically.
- **Helpers**: import from `tools/buck/exporter/lang/helpers.ts` for quick rule/label checks and sorted labels.
- **Detect hook**: implement a fast `detect(node)` filter when possible.
- **Labels**: prefer deriving labels from lockfiles or stable inputs; keep sorting deterministic.
- **Tests**: unit tests can run `export-graph.ts --simulate` with a tiny nodes.json.

### Importer-scoped lockfile labels (Node + Python)

For importer-scoped ecosystems (currently Node/PNPM and Python/uv), the exporter is allowed to attach a missing `lockfile:<path>#<importer>` label, but it must do so conservatively so raw rules do not accidentally participate in importer wiring.

- **Attachment policy**: auto-attach `lockfile:` labels only for macro-stamped targets (targets that already carry a `kind:*` label) when they have no `lockfile:` label yet.
- **Validation policy**: when a target already has a `lockfile:` label, validate it strictly (even if `kind:*` is missing) using the canonical parser `tools/lib/labels.ts:parseLockfileLabel(...)` (including importer-directory consistency and the repo-root `#.` special case).
- **Configuration registry**: importer-scoped adapters must read lockfile basenames and nearest-lockfile lookup from `tools/buck/exporter/lang/importer-scoped-registry.ts`. Do not embed lockfile basenames or bespoke nearest-lockfile scans in per-language adapters.
- **Implementation helpers**: exporter adapters should reuse `tools/buck/exporter/lang/importer-scoped-adapter.ts` and `tools/buck/exporter/lang/importer-lockfile-labels.ts` instead of re-implementing label attachment, lockfile discovery, or lockfile-label validation logic.
- **Error diagnostics**: if you need to distinguish “malformed label” vs “importer mismatch”, use `tools/lib/labels.ts:inspectLockfileLabel(...)` rather than hand-rolling partial parsing.

Example skeleton:

```ts
// tools/buck/exporter/lang/toy.ts
import { Adapter } from "./contract";
import { hasLabel, isRuleType } from "./helpers";

const toy: Adapter = {
  id: "toy",
  detect(node) {
    return isRuleType(node, "toy_") || hasLabel(node, "lang:toy");
  },
  async label(nodes) {
    return nodes.map((n) => ({ ...n, labels: [...(n.labels || []), "module:example@v0.0.0"] }));
  },
};
export default toy;
```

Validation check-list:

- Adapter file present and exports default `Adapter`.
- Label outputs are stable and sorted where applicable.
- Tests cover detection and label presence.

Note (C++ adapter): warn-only validation

- The built-in C++ adapter performs a minimal, warn-only validation: if a node lists C++-looking sources (e.g., files ending in `.cc`, `.cpp`, `.cxx`) but lacks both a `cxx_*` rule_type and the `lang:cpp` label, the exporter prints a warning. This does not fail the export; it is advisory to help maintain consistent labeling. Keep CI behavior unchanged — warnings are informative only.
