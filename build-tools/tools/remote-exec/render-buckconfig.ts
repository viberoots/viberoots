#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import { getFlagStr } from "../lib/cli";
import type { RemoteBuckConfigInput, RemoteBuckConfigResult } from "./render-buckconfig-model";
import {
  redactSecretLike,
  renderRemoteBuckconfigText,
  summarizeRemoteBuckconfig,
} from "./render-buckconfig-format";

export { fingerprintConfig, redactSecretLike } from "./render-buckconfig-format";
export { validateRenderedBuckConfigKeys } from "./render-buckconfig-validate";
export type { RemoteBuckConfigInput, RemoteBuckConfigResult } from "./render-buckconfig-model";

export async function renderRemoteBuckconfig(
  input: RemoteBuckConfigInput,
): Promise<RemoteBuckConfigResult> {
  const configText = renderRemoteBuckconfigText(input);
  const result = summarizeRemoteBuckconfig(input, configText);
  await fs.mkdir(input.artifactDir, { recursive: true });
  await fs.writeFile(result.configPath, configText, { mode: 0o600 });
  return result;
}

async function main() {
  const inputPath = getFlagStr("input");
  if (!inputPath) throw new Error("usage: render-buckconfig --input <json>");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as RemoteBuckConfigInput;
  const result = await renderRemoteBuckconfig(input);
  console.log(redactSecretLike(result.summary));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
