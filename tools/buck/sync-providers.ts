#!/usr/bin/env zx-wrapper
import { syncAllProviders } from "./providers/index";

const OUT_FILE = (argv.out as string) || "third_party/providers/TARGETS.auto";
const STRICT = String(argv.strict || "").toLowerCase() === "true" || argv.strict === true;
const LANG = (argv.lang as string) || "";

async function main() {
  await syncAllProviders({ outFile: OUT_FILE, strict: STRICT, lang: LANG });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
