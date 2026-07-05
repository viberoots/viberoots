#!/usr/bin/env zx-wrapper

const CONTROL_PLANE_REQUEST_TIMEOUT_MS = 60_000;

export async function readNixosSharedHostResourceGraphViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTROL_PLANE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/v1/resource-graph", opts.controlPlaneUrl), {
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${CONTROL_PLANE_REQUEST_TIMEOUT_MS}ms`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`/api/v1/resource-graph read failed for ${opts.controlPlaneUrl}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}
