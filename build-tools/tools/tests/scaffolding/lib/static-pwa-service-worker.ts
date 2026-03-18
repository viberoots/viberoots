#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

type RequestLike = {
  destination?: string;
  method?: string;
  mode?: string;
  url: string;
};

type EventHandler = (event: {
  request?: RequestLike;
  respondWith?: (response: Promise<Response> | Response) => void;
  waitUntil?: (work: Promise<unknown> | unknown) => void;
}) => void;

function requestUrl(origin: string, input: string | RequestLike): URL {
  const value = typeof input === "string" ? input : input.url;
  return new URL(value, origin);
}

class MemoryCache {
  readonly #entries = new Map<string, Response>();
  readonly #fetchImpl: (input: string | RequestLike) => Promise<Response>;
  readonly #origin: string;

  constructor(origin: string, fetchImpl: (input: string | RequestLike) => Promise<Response>) {
    this.#fetchImpl = fetchImpl;
    this.#origin = origin;
  }

  async addAll(inputs: string[]): Promise<void> {
    for (const input of inputs) {
      const response = await this.#fetchImpl(input);
      if (!response.ok) {
        throw new Error(`failed to precache ${input}: ${response.status}`);
      }
      this.#entries.set(this.#key(input), response.clone());
    }
  }

  async match(input: string | RequestLike): Promise<Response | undefined> {
    const cached = this.#entries.get(this.#key(input));
    return cached ? cached.clone() : undefined;
  }

  async put(input: string | RequestLike, response: Response): Promise<void> {
    this.#entries.set(this.#key(input), response.clone());
  }

  #key(input: string | RequestLike): string {
    const url = requestUrl(this.#origin, input);
    return url.origin === this.#origin ? `${url.pathname}${url.search}` : url.toString();
  }
}

class MemoryCacheStorage {
  readonly #caches = new Map<string, MemoryCache>();
  readonly #fetchImpl: (input: string | RequestLike) => Promise<Response>;
  readonly #origin: string;

  constructor(origin: string, fetchImpl: (input: string | RequestLike) => Promise<Response>) {
    this.#fetchImpl = fetchImpl;
    this.#origin = origin;
  }

  async delete(name: string): Promise<boolean> {
    return this.#caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.#caches.keys()];
  }

  async match(input: string | RequestLike): Promise<Response | undefined> {
    for (const cache of this.#caches.values()) {
      const cached = await cache.match(input);
      if (cached) {
        return cached;
      }
    }
    return undefined;
  }

  async open(name: string): Promise<MemoryCache> {
    const existing = this.#caches.get(name);
    if (existing) {
      return existing;
    }
    const cache = new MemoryCache(this.#origin, this.#fetchImpl);
    this.#caches.set(name, cache);
    return cache;
  }
}

async function responseForDistFile(distDir: string, url: URL): Promise<Response> {
  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const absPath = path.resolve(distDir, relativePath);
  const distRoot = path.resolve(distDir) + path.sep;
  if (absPath !== path.resolve(distDir, "index.html") && !absPath.startsWith(distRoot)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const body = await fsp.readFile(absPath);
    return new Response(body, { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

export async function createStaticPwaServiceWorkerHarness(distDir: string): Promise<{
  dispatchActivate: () => Promise<void>;
  dispatchFetch: (request: RequestLike) => Promise<Response>;
  dispatchInstall: () => Promise<void>;
  setOffline: (value: boolean) => void;
}> {
  const origin = "http://app.local";
  let offline = false;
  const handlers = new Map<string, EventHandler>();
  const fetchImpl = async (input: string | RequestLike): Promise<Response> => {
    if (offline) {
      throw new Error(`offline: ${requestUrl(origin, input).pathname}`);
    }
    return await responseForDistFile(distDir, requestUrl(origin, input));
  };
  const caches = new MemoryCacheStorage(origin, fetchImpl);
  const self = {
    addEventListener(type: string, handler: EventHandler) {
      handlers.set(type, handler);
    },
    clients: {
      async claim(): Promise<void> {},
    },
    location: new URL(origin),
    async skipWaiting(): Promise<void> {},
  };
  const serviceWorkerSource = await fsp.readFile(path.join(distDir, "service-worker.js"), "utf8");
  const context = vm.createContext({
    URL,
    caches,
    console,
    fetch: fetchImpl,
    location: self.location,
    self,
  });
  vm.runInContext(serviceWorkerSource, context, {
    filename: path.join(distDir, "service-worker.js"),
  });

  async function dispatchLifecycle(type: "activate" | "install"): Promise<void> {
    const handler = handlers.get(type);
    assert.ok(handler, `expected ${type} handler`);
    const pending: Promise<unknown>[] = [];
    handler({
      waitUntil(work) {
        pending.push(Promise.resolve(work));
      },
    });
    await Promise.all(pending);
  }

  return {
    async dispatchActivate(): Promise<void> {
      await dispatchLifecycle("activate");
    },
    async dispatchFetch(request: RequestLike): Promise<Response> {
      const handler = handlers.get("fetch");
      assert.ok(handler, "expected fetch handler");
      let responsePromise: Promise<Response> | null = null;
      handler({
        request,
        respondWith(response) {
          responsePromise = Promise.resolve(response);
        },
      });
      if (responsePromise) {
        return await responsePromise;
      }
      return await fetchImpl(request);
    },
    async dispatchInstall(): Promise<void> {
      await dispatchLifecycle("install");
    },
    setOffline(value: boolean): void {
      offline = value;
    },
  };
}
