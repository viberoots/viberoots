import React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { AppRegistry } from "react-native-web";
import { Home } from "./home";

function App(props: { url: string }) {
  return React.createElement(Home, { url: props.url });
}

AppRegistry.registerComponent("App", () => App);

export function renderParts(url: string): { appHtml: string; styleHtml: string } {
  const { element, getStyleElement } = AppRegistry.getApplication("App", {
    initialProps: { url },
  });
  const styleHtml = renderToStaticMarkup(getStyleElement());
  return { appHtml: renderToString(element), styleHtml };
}

export function render(url: string): string {
  return renderParts(url).appHtml;
}
