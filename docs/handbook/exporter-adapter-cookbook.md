### Exporter adapter cookbook

This guide shows how to write and test an exporter adapter with minimal ceremony using helpers and manifest-driven discovery.

- **Auto-discovery**: put `tools/buck/exporter/lang/<id>.ts` next to `contract.ts`. It will be discovered automatically.
- **Helpers**: import from `tools/buck/exporter/lang/helpers.ts` for quick rule/label checks and sorted labels.
- **Detect hook**: implement a fast `detect(node)` filter when possible.
- **Labels**: prefer deriving labels from lockfiles or stable inputs; keep sorting deterministic.
- **Tests**: unit tests can run `export-graph.ts --simulate` with a tiny nodes.json.

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
