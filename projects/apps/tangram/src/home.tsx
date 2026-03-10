import React from "react";
import { GameScreen } from "./ui/game-screen";

export function Home(props: { url: string }) {
  return <GameScreen url={props.url} />;
}
