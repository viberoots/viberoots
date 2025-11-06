/**
 * ESLint plugin: bucknix
 * Rule: no-raw-graph-json — forbid direct reads of tools/buck/graph.json outside allowlisted internals.
 */

const ALLOWED_PATHS = [
  /^tools\/buck\/exporter\//,
  /^tools\/buck\/export-graph\.ts$/,
  /^tools\/buck\/gen-auto-map\.ts$/,
  /^tools\/buck\/prebuild\//,
  /^tools\/buck\/prebuild-guard\.ts$/,
  /^tools\/lib\/graph-view\.ts$/,
];

const EXCLUDED_PATHS = [
  /^tools\/tests\//,
  /^docs\//,
  /^node_modules\//,
  /^buck-out\//,
  /^coverage\//,
];

function isAllowed(filePath) {
  const p = filePath.replace(/\\/g, "/");
  if (EXCLUDED_PATHS.some((re) => re.test(p))) return true; // never flag excluded
  return ALLOWED_PATHS.some((re) => re.test(p));
}

const TARGET_LITERAL = "tools/buck/graph.json";
const CALLEE_NAMES = new Set(["readGraph", "readFile", "readJson", "readFileSync"]);

/** @type {import('eslint').Rule.RuleModule} */
const noRawGraphJsonRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct reads of tools/buck/graph.json; use the Composite Graph API (tools/lib/graph-view.ts)",
      recommended: false,
    },
    schema: [],
    messages: {
      forbidden:
        "Do not read tools/buck/graph.json directly; use the Composite Graph API (tools/lib/graph-view.ts).",
    },
  },
  create(context) {
    const filename = String(context.getFilename ? context.getFilename() : "");
    if (isAllowed(filename)) {
      return {};
    }
    return {
      Literal(node) {
        if (typeof node.value === "string" && node.value === TARGET_LITERAL) {
          context.report({ node, messageId: "forbidden" });
        }
      },
      TemplateLiteral(node) {
        try {
          if (!node.quasis || node.quasis.length !== 1) return;
          const txt = String(node.quasis[0].value.cooked || "");
          if (txt === TARGET_LITERAL) context.report({ node, messageId: "forbidden" });
        } catch {}
      },
    };
  },
};

const plugin = {
  rules: {
    "no-raw-graph-json": noRawGraphJsonRule,
  },
};

export default plugin;
