import React from "react";
import { AppRegistry } from "react-native-web";
import { prewarmSolverRuntimeAssets } from "./game/solver/solver-runtime";
import { defaultTsModuleKey, loadTsModule } from "./ts-modules";
import { Home } from "./home";

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
}

function App(props: { url: string }) {
  return React.createElement(Home, { url: props.url });
}

AppRegistry.registerComponent("App", () => App);
registerServiceWorker();

const root = document.getElementById("app");
if (root) {
  const url = `${window.location.pathname}${window.location.search}`;
  AppRegistry.runApplication("App", {
    rootTag: root,
    hydrate: true,
    initialProps: { url },
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
