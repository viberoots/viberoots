#!/usr/bin/env zx-wrapper
import { httpGet } from "./webapp-static-hmr";

export function writeLibSource(clientValue: string, serverValue: string): string {
  return [
    `export const depClientMessage = (): string => "${clientValue}";`,
    `export const depServerMessage = (): string => "${serverValue}";`,
    "",
  ].join("\n");
}

function extractAssetUrls(html: string, baseUrl: string): string[] {
  const scriptRe = /<script[^>]*\ssrc="([^"]+)"[^>]*>/g;
  const urls: string[] = [];
  while (true) {
    const next = scriptRe.exec(html);
    if (!next) break;
    const src = String(next[1] || "").trim();
    if (!src) continue;
    urls.push(new URL(src, baseUrl).toString());
  }
  return urls;
}

export async function clientAssetsContain(pageUrl: string, needle: string): Promise<boolean> {
  const page = await httpGet(pageUrl);
  if (page.status !== 200) return false;
  // Next.js SSR pre-renders client components; needle often appears in initial HTML
  if (page.body.includes(needle)) return true;
  const assets = extractAssetUrls(page.body, pageUrl).filter((url) =>
    url.includes("/_next/static/"),
  );
  const results = await Promise.all(assets.map((url) => httpGet(url)));
  return results.some((r) => r.status === 200 && r.body.includes(needle));
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]+>/g, "").trim();
}

export function clientProbeTextFromHtml(html: string): string | null {
  const match = html.match(/<p id="client-probe"[^>]*>([\s\S]*?)<\/p>/i);
  if (!match) return null;
  return stripHtmlTags(String(match[1] || ""));
}

export async function readClientProbeText(pageUrl: string): Promise<string | null> {
  const page = await httpGet(pageUrl);
  if (page.status !== 200) return null;
  return clientProbeTextFromHtml(page.body);
}

export function nextWasmPageSource(): string {
  return [
    'import { depServerMessage } from "@libs/demo-lib";',
    'import { ClientProbe } from "./client-probe";',
    'import * as fsp from "node:fs/promises";',
    'import path from "node:path";',
    "",
    'export const dynamic = "force-dynamic";',
    "",
    "async function readDevWasmByteLength(): Promise<number> {",
    '  const wasmPath = path.join(process.cwd(), "app", "wasm-contract", "top.wasm");',
    "  const bytes = await fsp.readFile(wasmPath);",
    "  return bytes.byteLength;",
    "}",
    "",
    "export default async function HomePage() {",
    "  const serverWasmBytes = await readDevWasmByteLength();",
    "  return (",
    '    <main data-ssr-marker="next">',
    "      <h1>Hello from Next SSR</h1>",
    "      <ClientProbe />",
    '      <p id="server-probe">{`server:${depServerMessage()}`}</p>',
    '      <p id="server-wasm-probe">{`server-wasm:${serverWasmBytes}`}</p>',
    "    </main>",
    "  );",
    "}",
    "",
  ].join("\n");
}

export function nextWasmClientProbeSource(): string {
  return [
    '"use client";',
    "",
    'import { useEffect, useState } from "react";',
    'import { depClientMessage } from "@libs/demo-lib";',
    'import { readWasmContractBytes } from "./wasm-contract";',
    "",
    "export function ClientProbe() {",
    "  const [wasmBytes, setWasmBytes] = useState<number | null>(null);",
    "  useEffect(() => {",
    "    let mounted = true;",
    "    void readWasmContractBytes().then((bytes) => {",
    "      if (mounted) setWasmBytes(bytes.byteLength);",
    "    });",
    "    return () => {",
    "      mounted = false;",
    "    };",
    "  }, []);",
    '  return <p id="client-probe">{`client:${depClientMessage()}:wasm:${wasmBytes ?? "pending"}`}</p>;',
    "}",
    "",
  ].join("\n");
}
