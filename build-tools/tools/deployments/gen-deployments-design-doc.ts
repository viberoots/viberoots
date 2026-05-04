#!/usr/bin/env zx-wrapper
import { getFlagBool } from "../lib/cli";
import {
  assertDeploymentsDesignDocParity,
  readDeploymentsDesignDoc,
  renderDeploymentsDesignDoc,
  writeDeploymentsDesignDoc,
} from "./design-summary-doc";

async function main() {
  const current = await readDeploymentsDesignDoc();
  if (getFlagBool("check")) {
    assertDeploymentsDesignDocParity(current);
    console.log("deployments design doc is fresh");
    return;
  }
  const rendered = renderDeploymentsDesignDoc(current);
  if (rendered !== current) {
    await writeDeploymentsDesignDoc(rendered);
  }
  console.log("wrote docs/deployments-design.md");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
