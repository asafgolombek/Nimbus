import { Box, Static, Text } from "ink";
import type React from "react";

export type ResultStreamEntry =
  | { kind: "query"; text: string }
  | { kind: "reply"; text: string }
  | { kind: "error"; text: string }
  | { kind: "hitl-outcome"; text: string };

interface Props {
  readonly entries: ResultStreamEntry[];
  readonly liveBuffer: string;
  readonly hitlBanner: string | null;
}

function renderEntry(entry: ResultStreamEntry): React.JSX.Element {
  if (entry.kind === "query") {
    return (
      <Text>
        <Text dimColor>nimbus&gt;</Text> {entry.text}
      </Text>
    );
  }
  if (entry.kind === "reply") {
    return <Text>{entry.text}</Text>;
  }
  if (entry.kind === "error") {
    return <Text color="red">❌ {entry.text}</Text>;
  }
  return <Text color="yellow">{entry.text}</Text>;
}

export function ResultStream({ entries, liveBuffer, hitlBanner }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Static items={entries}>
        {(entry, index) => <Box key={index}>{renderEntry(entry)}</Box>}
      </Static>
      {liveBuffer === "" ? null : <Text>{liveBuffer}</Text>}
      {hitlBanner === null ? null : (
        <Box flexDirection="column" marginTop={1}>
          {hitlBanner.split("\n").map((line) => (
            <Text key={`hitl-${line}`} color="yellow">
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
