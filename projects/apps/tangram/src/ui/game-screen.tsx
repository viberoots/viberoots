import React from "react";
import { Pressable, Text, View } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";
import { transformCells } from "../game/geometry";
import {
  clearPersistedGameState,
  loadPersistedGameState,
  savePersistedGameState,
} from "../game/persistence";
import { tangramGameReducer } from "../game/reducer";
import { createGameViewSelector } from "../game/view-selector";
import { createInitialGameState } from "../game/state";
import { BoardGrid } from "./board-grid";
import { pageToViewportPosition } from "./game-screen-interaction-helpers";
import { gameScreenStyles as styles } from "./game-screen-styles";
import { PieceTray } from "./piece-tray";
import { useGameScreenInteractions } from "./use-game-screen-interactions";
import { useGameScreenKeyboard } from "./use-game-screen-keyboard";

function createInitialStateWithPersistence() {
  const initial = createInitialGameState();
  if (typeof window === "undefined") {
    return initial;
  }
  try {
    return loadPersistedGameState(window.localStorage, initial) ?? initial;
  } catch {
    return initial;
  }
}

function ActionButton(props: {
  label: string;
  onPress: () => void;
  testID?: string;
  tone?: "default" | "danger";
}) {
  return (
    <Pressable
      onPress={props.onPress}
      onClick={props.onPress}
      style={[
        styles.actionButton,
        props.tone === "danger" ? styles.actionButtonDanger : styles.actionButtonDefault,
      ]}
      accessibilityRole="button"
      testID={props.testID}
    >
      <Text style={styles.actionButtonText}>{props.label}</Text>
    </Pressable>
  );
}

export function GameScreen(props: { url: string }) {
  const [state, dispatch] = React.useReducer(
    tangramGameReducer,
    undefined,
    createInitialStateWithPersistence,
  );
  const selectGameView = React.useMemo(() => createGameViewSelector(), []);
  const viewModel = selectGameView(state);
  const boardGridElementRef = React.useRef<HTMLElement | null>(null);
  const skipNextPersistRef = React.useRef(false);

  const pieceById = React.useMemo(
    () => new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece])),
    [state.pieceCatalog],
  );
  const placedByInstanceId = React.useMemo(
    () => new Map(state.board.placedPieces.map((piece) => [piece.instanceId, piece])),
    [state.board.placedPieces],
  );

  const interactions = useGameScreenInteractions({
    state,
    dispatch,
    pieceById,
    placedByInstanceId,
    boardGridElementRef,
  });

  useGameScreenKeyboard({
    dispatch,
    dragSessionRef: interactions.dragSessionRef,
    placedByInstanceId,
    selectedPieceId: viewModel.toolbar.selectedPieceId,
    selectedInstanceId: viewModel.toolbar.selectedInstanceId,
    previewByPieceId: state.previewByPieceId,
  });

  const handleResetBoard = React.useCallback(() => {
    interactions.clearPendingTap();
    dispatch({ type: "board/reset" });
  }, [interactions]);

  const handleNewGame = React.useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        clearPersistedGameState(window.localStorage);
      } catch {}
      skipNextPersistRef.current = true;
    }
    interactions.clearPendingTap();
    dispatch({ type: "board/reset" });
  }, [interactions]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    try {
      savePersistedGameState(window.localStorage, state);
    } catch {}
  }, [state]);

  return (
    <View style={styles.page} testID="tangram-game-screen">
      <View style={styles.headerCard}>
        <Text style={styles.title}>Tangram Sandbox</Text>
        <Text style={styles.subtitle}>SSR route: {props.url}</Text>
        <Text style={styles.subtitle}>Persistence: local, versioned, safe-restore</Text>
        <View style={styles.actionRow}>
          <ActionButton
            label="Reset Board"
            onPress={handleResetBoard}
            testID="tangram-action-reset"
          />
          <ActionButton
            label="New Game"
            onPress={handleNewGame}
            testID="tangram-action-new-game"
            tone="danger"
          />
        </View>
      </View>

      <View style={styles.layout}>
        <BoardGrid
          board={viewModel.board}
          onStartDragPlaced={interactions.handleStartDragPlaced}
          snapTargetCellKeys={interactions.snapTargetKeySet}
          onBoardGridElement={(element) => {
            boardGridElementRef.current = element;
          }}
        />
        <PieceTray
          tray={viewModel.tray}
          returnTargetPieceId={interactions.trayReturnTargetPieceId}
          onStartDrag={interactions.handleStartDrag}
          onEndDrag={interactions.handleEndDrag}
        />
      </View>

      <View style={styles.statusCard} testID="tangram-status-card">
        <Text style={styles.statusText}>Catalog pieces: {viewModel.status.catalogPieceCount}</Text>
        <Text style={styles.statusText}>Placed pieces: {viewModel.status.placedPieceCount}</Text>
        <Text style={styles.statusText}>
          Selected piece: {viewModel.toolbar.selectedPieceId ?? "none"}
        </Text>
        <Text style={styles.statusText} testID="tangram-selection-transform">
          Transform:{" "}
          {viewModel.toolbar.selectedRotation === null
            ? "none"
            : `${viewModel.toolbar.selectedRotation}deg, flipped=${viewModel.toolbar.selectedFlipped ? "yes" : "no"}`}
        </Text>
        <Text
          style={[styles.statusText, viewModel.status.isSolved ? styles.solvedText : null]}
          testID="tangram-solved-status"
        >
          {viewModel.status.isSolved ? "Solved: yes" : "Solved: no"}
        </Text>
      </View>

      {interactions.dragVisual ? (
        <View
          style={styles.dragOverlay}
          testID="tangram-drag-ghost"
          data-piece-id={interactions.dragVisual.pieceId}
        >
          {(() => {
            const session = interactions.dragSessionRef.current;
            const piece = pieceById.get(interactions.dragVisual.pieceId);
            if (!session || !piece) {
              return null;
            }
            const cells = transformCells(piece.baseCells, session.transform);
            const viewportPointer = pageToViewportPosition(interactions.dragVisual.pointer);
            return cells.map((cell) => (
              <View
                key={`${interactions.dragVisual.pieceId}-ghost-${cell.x},${cell.y}`}
                style={[
                  styles.dragCell,
                  {
                    left: viewportPointer.x - session.grabbedOffsetPx.x + cell.x * BOARD_CELL_SIZE,
                    top: viewportPointer.y - session.grabbedOffsetPx.y + cell.y * BOARD_CELL_SIZE,
                    backgroundColor: piece.color,
                  },
                ]}
              />
            ));
          })()}
        </View>
      ) : null}
    </View>
  );
}
