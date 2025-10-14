#!/usr/bin/env zx-wrapper
import { syncAllProviders } from "./providers/index.ts";

const OUT_FILE = (argv.out as string) || "third_party/providers/TARGETS.auto";
const STRICT = String(argv.strict || "").toLowerCase() === "true" || argv.strict === true;
const LANG = (argv.lang as string) || "";
const EMIT_INDEX = String(argv["emit-index"] || argv.emitIndex || "").toLowerCase() === "true";

async function main() {
  await syncAllProviders({ outFile: OUT_FILE, strict: STRICT, lang: LANG });
  if (EMIT_INDEX) {
    const { generateProviderIndex } = await import("./gen-provider-index.ts");
    await generateProviderIndex({ outFile: "third_party/providers/provider_index.bzl" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
