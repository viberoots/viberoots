import React from "react";
import { AppRegistry } from "react-native-web";
import { defaultTsModuleKey, loadTsModule } from "./ts-modules";
import { Home } from "./home";

function App(props: { url: string }) {
  return React.createElement(Home, { url: props.url });
}

AppRegistry.registerComponent("App", () => App);

const root = document.getElementById("app");
if (root) {
  const url = `${window.location.pathname}${window.location.search}`;
  AppRegistry.runApplication("App", {
    rootTag: root,
    hydrate: true,
    initialProps: { url },
  });
  root.setAttribute("data-client-hydrated", "true");
  const moduleKey = defaultTsModuleKey();
  if (moduleKey !== "client-entry") {
    void loadTsModule(moduleKey).then(() => {
      root.setAttribute("data-ts-module", moduleKey);
    });
  }
}
