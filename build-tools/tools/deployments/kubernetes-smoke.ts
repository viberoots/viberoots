#!/usr/bin/env zx-wrapper
export async function smokeKubernetesRelease(opts: {
  smokeUrl: string;
  expectedContent?: string;
  connectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ publicUrl: string }> {
  const publicUrl = new URL(opts.smokeUrl);
  const requestUrl = opts.connectOverride
    ? new URL(
        `${opts.connectOverride.protocol}//${opts.connectOverride.hostname}:${opts.connectOverride.port}${publicUrl.pathname}${publicUrl.search}`,
      )
    : new URL(publicUrl.toString());
  const response = await fetch(requestUrl, {
    headers: { host: publicUrl.host },
  });
  if (response.status !== 200) {
    throw new Error(`service smoke expected 200 from ${publicUrl}, got ${response.status}`);
  }
  if (opts.expectedContent) {
    const text = await response.text();
    if (!text.includes(opts.expectedContent)) {
      throw new Error(`service smoke content mismatch at ${publicUrl}`);
    }
  }
  return { publicUrl: publicUrl.toString() };
}
