#!/usr/bin/env zx-wrapper
import { getFlagBool } from "../lib/cli";
import {
  assertProviderCapabilitiesDocParity,
  readProviderCapabilitiesDoc,
  renderProviderCapabilitiesDoc,
  writeProviderCapabilitiesDoc,
} from "./provider-capabilities/doc";

async function main() {
  const current = await readProviderCapabilitiesDoc();
  if (getFlagBool("check")) {
    assertProviderCapabilitiesDocParity(current);
    console.log("provider capabilities doc is fresh");
    return;
  }
  const rendered = renderProviderCapabilitiesDoc(current);
  if (rendered !== current) {
    await writeProviderCapabilitiesDoc(rendered);
  }
  console.log("wrote docs/deployment-provider-capabilities.md");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
