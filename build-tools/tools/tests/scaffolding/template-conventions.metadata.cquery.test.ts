#!/usr/bin/env zx-wrapper
import { test } from "node:test";

type TemplateExpectation = {
  script: string;
  requiredLabels: string[];
  requiredTemplateRoots: string[];
};

const TEMPLATE_CLASSIFICATIONS = new Set([
  "template:smoke",
  "template:contract",
  "template:shared",
]);

const EXPECTATIONS: TemplateExpectation[] = [
  {
    script: "build-tools/tools/tests/scaffolding/smoke.lib-readme.test.ts",
    requiredLabels: ["template:go/lib", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/go/lib/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/smoke.cli-readme.test.ts",
    requiredLabels: ["template:go/cli", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/go/cli/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/go-lib.scaffold-and-build.test.ts",
    requiredLabels: ["template:go/lib", "template:contract"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/go/lib/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/go-cli.scaffold-and-build.test.ts",
    requiredLabels: ["template:go/cli", "template:contract"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/go/cli/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/cpp.lib.shape-and-build.test.ts",
    requiredLabels: ["template:cpp/lib", "template:contract"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/cpp/lib/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/node-lib.nix-node-test.with-tests-pass.test.ts",
    requiredLabels: ["template:node/lib", "template:contract"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/node/lib/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/node-cli.nix-node-test.with-tests-pass.test.ts",
    requiredLabels: ["template:node/cli", "template:contract"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/node/cli/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/webapp.scaffold-and-build.test.ts",
    requiredLabels: ["template:node/webapp-static", "template:contract"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/node/webapp-static/"],
  },
  {
    script:
      "build-tools/tools/tests/scaffolding/webapp-ssr.scaffold-contract-and-runtime-smoke.test.ts",
    requiredLabels: [
      "template:node/webapp-ssr-express",
      "template:node/webapp-ssr-next",
      "template:shared",
    ],
    requiredTemplateRoots: [
      "build-tools/tools/scaffolding/templates/node/webapp-ssr-express/",
      "build-tools/tools/scaffolding/templates/node/webapp-ssr-next/",
    ],
  },
  {
    script: "build-tools/tools/tests/scaffolding/python-lib.scaffold-files.test.ts",
    requiredLabels: ["template:python/lib", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/python/lib/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/python-app.scaffold-files.test.ts",
    requiredLabels: ["template:python/app", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/python/app/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/python-wasm-app.scaffold-smoke.test.ts",
    requiredLabels: ["template:python/wasm-app", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/python/wasm-app/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/scaf-language-new.manifest-write.test.ts",
    requiredLabels: ["template:language/kit", "template:contract"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/language/kit/"],
  },
  {
    script: "build-tools/tools/tests/scaffolding/lang-kit.scaffold-smoke.test.ts",
    requiredLabels: ["template:language/kit", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/language/kit/"],
  },
  {
    script: "build-tools/tools/tests/ts-cpp-go-wasm/pr8-scaffolding.scaf-new-dry-run.test.ts",
    requiredLabels: ["template:ts/go-cpp-lib", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/ts/go-cpp-lib/"],
  },
  {
    script:
      "build-tools/tools/tests/ts-cpp-go-wasm/pr8-scaffolding.wasm-app.scaffold-smoke.test.ts",
    requiredLabels: ["template:ts/wasm-app", "template:smoke"],
    requiredTemplateRoots: ["build-tools/tools/scaffolding/templates/ts/wasm-app/"],
  },
  {
    script: "build-tools/tools/tests/ts-cpp-go-wasm/pr8-scaffolding.templates-exist.test.ts",
    requiredLabels: ["template:ts/go-cpp-lib", "template:ts/wasm-app", "template:shared"],
    requiredTemplateRoots: [
      "build-tools/tools/scaffolding/templates/ts/go-cpp-lib/",
      "build-tools/tools/scaffolding/templates/ts/wasm-app/",
    ],
  },
];

function targetNameFromScript(script: string): string {
  let n = script;
  const prefix = "build-tools/tools/tests/";
  if (n.startsWith(prefix)) n = n.slice(prefix.length);
  if (n.endsWith(".ts")) n = n.slice(0, -3);
  if (n.endsWith(".test")) n = n.slice(0, -5);
  return n.replace(/[/.-]/g, "_");
}

function normalizeTarget(target: string): string {
  return target.replace(/\s+\([^)]*\)$/, "");
}

function isolationId(prefix: string): string {
  return `${prefix}_${process.pid}_${Date.now()}`;
}

test("template-owned tests expose labels and template inputs", async () => {
  const targets = EXPECTATIONS.map((entry) => `//:${targetNameFromScript(entry.script)}`);
  const query = `set(${targets.join(" ")})`;
  const isolationDir = isolationId("template_conventions_metadata_cquery");
  try {
    const out = await $({
      stdio: "pipe",
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} cquery ${query} --json --output-attribute labels --output-attribute template_inputs`;
    const raw = JSON.parse(out.stdout) as Record<
      string,
      { labels?: string[]; template_inputs?: string[] }
    >;

    const byTarget = new Map<string, { labels: string[]; templateInputs: string[] }>();
    for (const [key, value] of Object.entries(raw)) {
      byTarget.set(normalizeTarget(key), {
        labels: Array.isArray(value.labels) ? value.labels.map(String) : [],
        templateInputs: Array.isArray(value.template_inputs)
          ? value.template_inputs.map(String)
          : [],
      });
    }

    for (const entry of EXPECTATIONS) {
      const target = `root//:${targetNameFromScript(entry.script)}`;
      const node = byTarget.get(target);
      if (!node) throw new Error(`missing cquery result for ${target}`);

      for (const label of entry.requiredLabels) {
        if (!node.labels.includes(label)) {
          throw new Error(`missing label ${label} on ${target}`);
        }
      }

      const classCount = node.labels.filter((label) => TEMPLATE_CLASSIFICATIONS.has(label)).length;
      if (classCount !== 1) {
        throw new Error(
          `expected exactly one template classification on ${target}, got ${classCount}`,
        );
      }

      if (node.templateInputs.length === 0) {
        throw new Error(`missing template_inputs for ${target}`);
      }

      for (const root of entry.requiredTemplateRoots) {
        if (!node.templateInputs.some((src) => src.includes(root))) {
          throw new Error(`expected template_inputs for ${target} to include ${root}`);
        }
      }
    }
  } finally {
    await $({
      stdio: "ignore",
      reject: false,
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} kill`;
  }
});

test("non-template tests do not carry template labels", async () => {
  const isolationDir = isolationId("template_conventions_non_template_labels");
  try {
    const out = await $({
      stdio: "pipe",
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} cquery //:scaffolding_macros_exports_present --json --output-attribute labels`;
    const raw = JSON.parse(out.stdout) as Record<string, { labels?: string[] }>;
    const first = Object.values(raw)[0] || {};
    const labels = Array.isArray(first.labels) ? first.labels.map(String) : [];
    const templateLabels = labels.filter((label) => label.startsWith("template:"));
    if (templateLabels.length !== 0) {
      throw new Error(
        `expected no template labels on non-template test, got: ${templateLabels.join(", ")}`,
      );
    }
  } finally {
    await $({
      stdio: "ignore",
      reject: false,
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} kill`;
  }
});
