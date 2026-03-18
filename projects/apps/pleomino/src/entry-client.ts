import React from "react";
import { AppRegistry } from "react-native-web";
import { prewarmSolverRuntimeAssets } from "./game/solver/solver-runtime";
import { defaultTsModuleKey, loadTsModule } from "./ts-modules";
import { Home } from "./home";

const SERVICE_WORKER_TAKEOVER_RELOAD_KEY = "pleomino-sw-takeover-reload";

function ensureServiceWorkerControlsPage(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  if (navigator.serviceWorker.controller) {
    try {
      window.sessionStorage.removeItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY);
    } catch {
      // Ignore session storage errors.
    }
    return;
  }

  const reloadOnce = () => {
    if (navigator.serviceWorker.controller) {
      return;
    }
    try {
      if (window.sessionStorage.getItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY) === "1") {
        return;
      }
      window.sessionStorage.setItem(SERVICE_WORKER_TAKEOVER_RELOAD_KEY, "1");
    } catch {
      // Continue even if session storage is unavailable.
    }
    window.location.reload();
  };

  const handleControllerChange = () => {
    navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    reloadOnce();
  };

  navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
  void navigator.serviceWorker.ready.then(() => {
    window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      reloadOnce();
    }, 1500);
  });
}

function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  void navigator.serviceWorker
    .register("/service-worker.js", {
      scope: "/",
      updateViaCache: "none",
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pleomino] service worker registration failed: ${message}`);
    });
  ensureServiceWorkerControlsPage();
}

function App(props: { url: string }) {
  return React.createElement(Home, { url: props.url });
}

AppRegistry.registerComponent("App", () => App);
registerServiceWorker();

const root = document.getElementById("app");
if (root) {
  AppRegistry.runApplication("App", {
    rootTag: root,
    hydrate: false,
    initialProps: { url: `${window.location.pathname}${window.location.search}` },
  });
  root.setAttribute("data-client-hydrated", "true");
  prewarmSolverRuntimeAssets();
  const moduleKey = defaultTsModuleKey();
  if (moduleKey !== "client-entry") {
    void loadTsModule(moduleKey).then(() => {
      root.setAttribute("data-ts-module", moduleKey);
    });
  }
}
