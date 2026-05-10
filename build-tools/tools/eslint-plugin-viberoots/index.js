/**
 * ESLint plugin: viberoots
 * Rule: no-raw-graph-json — forbid direct reads of build-tools/tools/buck/graph.json outside allowlisted internals.
 */

const ALLOWED_PATHS = [
  /\/tools\/buck\/exporter\//,
  /\/tools\/buck\/export-graph\.ts$/,
  /\/tools\/buck\/gen-auto-map\.ts$/,
  /\/tools\/buck\/prebuild\//,
  /\/tools\/buck\/prebuild-guard\.ts$/,
  /\/tools\/lib\/graph-view\.ts$/,
];

const EXCLUDED_PATHS = [
  /\/tools\/tests\//,
  /\/docs\//,
  /\/node_modules\//,
  // Usually, buck-out is generated and should not participate in lint rules.
  // However, our test temp repos live under buck-out/tmp/tmpdir/ and must still be lintable.
  /\/buck-out\/(?!tmp\/tmpdir\/)/,
  /\/coverage\//,
];

function isAllowed(filePath) {
  const p = filePath.replace(/\\/g, "/");
  // Try repo-relative if possible
  let rel = p;
  try {
    const cwd = process.cwd().replace(/\\/g, "/");
    if (p.startsWith(cwd + "/")) {
      rel = p.slice(cwd.length + 1);
    }
  } catch {}
  // Exclude tests/docs/etc. regardless of absolute/relative path
  if (EXCLUDED_PATHS.some((re) => re.test(p) || re.test(rel))) return true;
  // Allow specific internal paths
  if (ALLOWED_PATHS.some((re) => re.test(p) || re.test(rel))) return true;
  return false;
}

const TARGET_LITERAL = "build-tools/tools/buck/graph.json";
const CALLEE_NAMES = new Set(["readGraph", "readFile", "readJson", "readFileSync"]);

/** @type {import('eslint').Rule.RuleModule} */
const noRawGraphJsonRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct reads of build-tools/tools/buck/graph.json; use the Composite Graph API (build-tools/tools/lib/graph-view.ts)",
      recommended: false,
    },
    schema: [],
    messages: {
      forbidden:
        "Do not read build-tools/tools/buck/graph.json directly; use the Composite Graph API (build-tools/tools/lib/graph-view.ts).",
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
