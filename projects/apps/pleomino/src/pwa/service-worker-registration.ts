const SERVICE_WORKER_TAKEOVER_RELOAD_KEY = "pleomino-sw-takeover-reload";

export { SERVICE_WORKER_TAKEOVER_RELOAD_KEY };

function clearTakeoverReloadGuard(storage: Storage): void {
  try {
    storage.removeItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY);
  } catch {}
}

function shouldSkipTakeoverReload(storage: Storage): boolean {
  try {
    if (storage.getItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY) === "1") {
      return true;
    }
    storage.setItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY, "1");
  } catch {}
  return false;
}

export function ensureServiceWorkerControlsPage(args: {
  location: Location;
  reload?: () => void;
  serviceWorker: ServiceWorkerContainer;
  sessionStorage: Storage;
}): void {
  if (args.serviceWorker.controller) {
    clearTakeoverReloadGuard(args.sessionStorage);
    return;
  }

  const reloadOnce = () => {
    if (args.serviceWorker.controller || shouldSkipTakeoverReload(args.sessionStorage)) {
      return;
    }
    (args.reload ?? (() => args.location.reload()))();
  };

  const handleControllerChange = () => {
    args.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    reloadOnce();
  };

  args.serviceWorker.addEventListener("controllerchange", handleControllerChange);
  void args.serviceWorker.ready.then(() => {
    window.setTimeout(() => {
      args.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      reloadOnce();
    }, 1500);
  });
}

export function registerServiceWorker(args: {
  location: Location;
  navigator: Navigator;
  sessionStorage: Storage;
}): void {
  if (typeof window === "undefined" || !("serviceWorker" in args.navigator)) {
    return;
  }
  void args.navigator.serviceWorker
    .register("/service-worker.js", {
      scope: "/",
      updateViaCache: "none",
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pleomino] service worker registration failed: ${message}`);
    });
  ensureServiceWorkerControlsPage({
    location: args.location,
    serviceWorker: args.navigator.serviceWorker,
    sessionStorage: args.sessionStorage,
  });
}
