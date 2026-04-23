import { Box, Text, useStdin } from "ink";
import React from "react";

import { appendQuery, readHistory } from "./query-history.ts";
import type { TuiMode } from "./state.ts";

interface Props {
  mode: TuiMode;
  historyPath: string;
  onSubmit: (query: string) => void;
  onHitlKey: (key: string) => void;
  onCancelKey: () => void;
  showCancelHint: boolean;
}

/**
 * Process a raw data chunk from stdin into individual actions.
 *
 * stdin.write() in ink-testing-library emits the entire string as one 'data'
 * event (e.g. "hello" is five characters in one chunk). We iterate the
 * string ourselves, handling multi-character escape sequences, control
 * characters, and printable text.
 */
function processChunk(
  chunk: string,
  bufRef: React.MutableRefObject<string>,
  histCursorRef: React.MutableRefObject<number | null>,
  historyRef: React.MutableRefObject<string[]>,
  inHitlRef: React.MutableRefObject<boolean>,
  disabledRef: React.MutableRefObject<boolean>,
  onSubmit: (q: string) => void,
  onCancel: () => void,
  onHitlKey: (k: string) => void,
  historyPathRef: React.MutableRefObject<string>,
  forceRender: () => void,
): void {
  let i = 0;
  while (i < chunk.length) {
    // ── Escape sequences ───────────────────────────────────────────────────
    if (chunk[i] === "\x1b") {
      const three = chunk.slice(i, i + 3);
      if (three === "\x1B[A") {
        // Up arrow
        i += 3;
        if (!inHitlRef.current && !disabledRef.current) {
          const h = historyRef.current;
          if (h.length > 0) {
            const cur = histCursorRef.current;
            const next = cur === null ? h.length - 1 : Math.max(0, cur - 1);
            histCursorRef.current = next;
            bufRef.current = h[next] ?? "";
            forceRender();
          }
        }
        continue;
      }
      if (three === "\x1B[B") {
        // Down arrow
        i += 3;
        if (!inHitlRef.current && !disabledRef.current) {
          const h = historyRef.current;
          const cur = histCursorRef.current;
          if (cur !== null) {
            const next = cur + 1;
            if (next >= h.length) {
              histCursorRef.current = null;
              bufRef.current = "";
            } else {
              histCursorRef.current = next;
              bufRef.current = h[next] ?? "";
            }
            forceRender();
          }
        }
        continue;
      }
      // Skip other escape sequences (e.g. \x1b[C for right arrow)
      i++;
      while (i < chunk.length) {
        const c = chunk.charCodeAt(i);
        i++;
        // Final byte of a CSI sequence is 0x40–0x7E
        if (c >= 0x40 && c <= 0x7e) {
          break;
        }
      }
      continue;
    }

    const ch = chunk[i] ?? "";
    i++;

    // ── Ctrl+C ─────────────────────────────────────────────────────────────
    if (ch === "\x03") {
      onCancel();
      continue;
    }

    // ── Enter / Return ─────────────────────────────────────────────────────
    if (ch === "\r" || ch === "\n") {
      if (!inHitlRef.current && !disabledRef.current) {
        const trimmed = bufRef.current.trim();
        if (trimmed !== "") {
          void appendQuery(historyPathRef.current, trimmed).then(() => {
            void readHistory(historyPathRef.current).then((entries) => {
              historyRef.current = entries;
            });
          });
          onSubmit(trimmed);
          bufRef.current = "";
          histCursorRef.current = null;
          forceRender();
        }
      }
      continue;
    }

    // ── Backspace / Delete ─────────────────────────────────────────────────
    if (ch === "\x7f" || ch === "\x08") {
      if (!inHitlRef.current && !disabledRef.current) {
        bufRef.current = bufRef.current.slice(0, -1);
        forceRender();
      }
      continue;
    }

    // ── Other control characters ───────────────────────────────────────────
    if (ch.charCodeAt(0) < 32) {
      continue;
    }

    // ── Printable character ────────────────────────────────────────────────
    if (inHitlRef.current) {
      if (ch === "a" || ch === "r" || ch === "d" || ch === "q") {
        onHitlKey(ch);
      }
    } else if (!disabledRef.current) {
      bufRef.current += ch;
      forceRender();
    }
  }
}

export function QueryInput(props: Props): React.JSX.Element {
  const { mode, historyPath, onSubmit, onHitlKey, onCancelKey, showCancelHint } = props;

  // Mutable buffer — updated synchronously inside the data handler so that
  // consecutive stdin.write() calls in tests (e.g. "hello" then "\r") see
  // the correct value without waiting for a React state flush.
  const bufRef = React.useRef("");
  const histCursorRef = React.useRef<number | null>(null);
  const historyRef = React.useRef<string[]>([]);
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  // Stable refs so the data handler never captures stale closures
  const inHitlRef = React.useRef(mode === "awaiting-hitl");
  const disabledRef = React.useRef(mode === "streaming" || mode === "disconnected");
  const historyPathRef = React.useRef(historyPath);
  const onSubmitRef = React.useRef(onSubmit);
  const onHitlKeyRef = React.useRef(onHitlKey);
  const onCancelKeyRef = React.useRef(onCancelKey);

  inHitlRef.current = mode === "awaiting-hitl";
  disabledRef.current = mode === "streaming" || mode === "disconnected";
  historyPathRef.current = historyPath;
  onSubmitRef.current = onSubmit;
  onHitlKeyRef.current = onHitlKey;
  onCancelKeyRef.current = onCancelKey;

  // Load history from file (async; populates historyRef before first Up press)
  React.useEffect(() => {
    void readHistory(historyPath).then((entries) => {
      historyRef.current = entries;
    });
  }, [historyPath]);

  const { stdin } = useStdin();

  // useLayoutEffect runs synchronously after each render, ensuring the 'data'
  // listener is installed before the test's first stdin.write() fires.
  React.useLayoutEffect(() => {
    const handler = (data: unknown): void => {
      processChunk(
        String(data),
        bufRef,
        histCursorRef,
        historyRef,
        inHitlRef,
        disabledRef,
        onSubmitRef.current,
        onCancelKeyRef.current,
        onHitlKeyRef.current,
        historyPathRef,
        forceRender,
      );
    };
    stdin?.on("data", handler);
    return () => {
      stdin?.off("data", handler);
    };
  }, [stdin]);

  const inHitl = mode === "awaiting-hitl";
  const disabled = mode === "streaming" || mode === "disconnected";
  const promptText = inHitl ? "nimbus[hitl]>" : "nimbus>";
  const displayValue = bufRef.current;

  return (
    <Box flexDirection="column">
      <Box>
        {disabled ? <Text color="gray">{promptText} </Text> : <Text>{promptText} </Text>}
        {inHitl ? (
          <Text dimColor>[a]pprove [r]eject [d]etails [q]uit</Text>
        ) : (
          <Text dimColor={disabled}>{displayValue}</Text>
        )}
      </Box>
      {showCancelHint ? <Text color="yellow">^C Press again within 2s to exit</Text> : null}
    </Box>
  );
}
