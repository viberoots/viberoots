#!/usr/bin/env zx-wrapper
import { getFlagBool } from "../lib/cli";
import { writeIfChanged } from "../lib/fs-helpers";
import {
  GENERATED_ADAPTER_BZL_PATH,
  GENERATED_RESOLVER_JSON_PATH,
  GENERATED_TAXONOMY_TS_PATH,
  readGeneratedFile,
  readTemplateManifest,
  renderGeneratedTaxonomyTs,
  renderResolverJson,
  renderTemplateTaxonomyAdapterBzl,
} from "./template-manifest";

type RenderedOutput = {
  path: string;
  content: string;
};

async function renderedOutputs(): Promise<RenderedOutput[]> {
  const manifest = await readTemplateManifest();
  return [
    {
      path: GENERATED_TAXONOMY_TS_PATH,
      content: renderGeneratedTaxonomyTs(manifest),
    },
    {
      path: GENERATED_ADAPTER_BZL_PATH,
      content: renderTemplateTaxonomyAdapterBzl(manifest),
    },
    {
      path: GENERATED_RESOLVER_JSON_PATH,
      content: renderResolverJson(manifest),
    },
  ];
}

async function checkFreshness(outputs: RenderedOutput[]): Promise<void> {
  const stale: string[] = [];
  for (const out of outputs) {
    const current = await readGeneratedFile(out.path).catch(() => "");
    if (current !== out.content) stale.push(out.path);
  }
  if (stale.length === 0) {
    console.log("template-manifest artifacts: fresh");
    return;
  }
  console.error("template-manifest artifacts are stale:");
  for (const p of stale) console.error(` - ${p}`);
  console.error(
    "refresh with: node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts",
  );
  process.exit(2);
}

async function writeOutputs(outputs: RenderedOutput[]): Promise<void> {
  for (const out of outputs) {
    await writeIfChanged(out.path, out.content);
    console.log(`wrote ${out.path}`);
  }
}

async function main() {
  const check = getFlagBool("check");
  const outputs = await renderedOutputs();
  if (check) {
    await checkFreshness(outputs);
    return;
  }
  await writeOutputs(outputs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
