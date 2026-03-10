import React from "react";
import { GameScreen } from "./game-screen";

export function GameShell(props: { url: string }) {
  return <GameScreen url={props.url} />;
}
