import React from "react";
import { AppRegistry } from "react-native-web";
import { prewarmSolverRuntimeAssets } from "./game/solver/solver-runtime";
import { registerServiceWorker } from "./pwa/service-worker-registration";
import { defaultTsModuleKey, loadTsModule } from "./ts-modules";
import { GameScreen } from "./ui/game-screen";

function App(props: { url: string }) {
  return React.createElement(GameScreen, { url: props.url });
}

AppRegistry.registerComponent("App", () => App);
registerServiceWorker({
  location: window.location,
  navigator: window.navigator,
  sessionStorage: window.sessionStorage,
});

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
