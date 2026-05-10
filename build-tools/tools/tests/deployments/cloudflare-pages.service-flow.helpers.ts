#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";

export async function writeCloudflareServiceArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

export async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

export function fakeCloudflareOverrides(
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
): Record<string, string> {
  return {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}
