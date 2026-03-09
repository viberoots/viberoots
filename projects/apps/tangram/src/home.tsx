import React from "react";
import { GameShell } from "./ui/game-shell";

export function Home(props: { url: string }) {
  return <GameShell url={props.url} />;
}
