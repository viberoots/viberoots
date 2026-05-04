/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureServiceWorkerControlsPage,
  registerServiceWorker,
  SERVICE_WORKER_TAKEOVER_RELOAD_KEY,
} from "../src/pwa/service-worker-registration";

type ServiceWorkerListener = () => void;

function createServiceWorkerContainer(controller: ServiceWorker | null = null) {
  let currentController = controller;
  const listeners = new Set<ServiceWorkerListener>();
  return {
    get controller() {
      return currentController;
    },
    set controller(nextController: ServiceWorker | null) {
      currentController = nextController;
    },
    ready: Promise.resolve({ active: {} as ServiceWorkerRegistration["active"] }),
    register: vi.fn(async () => ({ scope: "/" }) as ServiceWorkerRegistration),
    addEventListener(_type: string, listener: ServiceWorkerListener) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: ServiceWorkerListener) {
      listeners.delete(listener);
    },
    dispatchControllerChange() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

describe("pwa service worker registration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("registers the production service worker with the static app scope", async () => {
    const serviceWorker = createServiceWorkerContainer({} as ServiceWorker);
    const navigatorShim = { serviceWorker } as unknown as Navigator;

    registerServiceWorker({
      location: window.location,
      navigator: navigatorShim,
      sessionStorage: window.sessionStorage,
    });

    await Promise.resolve();
    expect(serviceWorker.register).toHaveBeenCalledWith("/service-worker.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("reloads once when service worker takeover completes after initial load", async () => {
    vi.useFakeTimers();
    const serviceWorker = createServiceWorkerContainer(null);
    const reloadSpy = vi.fn();

    ensureServiceWorkerControlsPage({
      location: window.location,
      reload: reloadSpy,
      serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
      sessionStorage: window.sessionStorage,
    });
    serviceWorker.dispatchControllerChange();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY)).toBe("1");

    serviceWorker.dispatchControllerChange();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clears the takeover reload guard when the page is already controlled", () => {
    window.sessionStorage.setItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY, "1");
    const serviceWorker = createServiceWorkerContainer({} as ServiceWorker);

    ensureServiceWorkerControlsPage({
      location: window.location,
      serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
      sessionStorage: window.sessionStorage,
    });

    expect(window.sessionStorage.getItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY)).toBeNull();
  });
});
