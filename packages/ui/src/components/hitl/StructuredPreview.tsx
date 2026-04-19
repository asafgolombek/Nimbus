import { type ReactNode, useState } from "react";

interface Props {
  details?: Record<string, unknown>;
}

const LONG_STRING = 80;

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function ScalarValue({ v }: { v: string | number | boolean }): ReactNode {
  const s = String(v);
  const [expanded, setExpanded] = useState(false);
  if (typeof v === "string" && s.length > LONG_STRING) {
    return (
      <span>
        {expanded ? s : `${s.slice(0, LONG_STRING)}…`}{" "}
        <button
          type="button"
          className="text-[var(--color-accent)] underline"
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? "Hide" : "Show full"}
        </button>
      </span>
    );
  }
  return <>{s}</>;
}

function PreviewRows({
  record,
  depth,
}: {
  record: Record<string, unknown>;
  depth: number;
}): ReactNode {
  const keys = Object.keys(record).filter((k) => record[k] !== null && record[k] !== undefined);
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-sm">
      {keys.map((k) => (
        <div key={k} className="contents">
          <dt className="text-[var(--color-fg-muted)]">{k}</dt>
          <dd className="text-[var(--color-fg)] break-words">
            <Value v={record[k]} depth={depth} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Value({ v, depth }: { v: unknown; depth: number }): ReactNode {
  if (v === null || v === undefined) return null;
  if (isScalar(v)) return <ScalarValue v={v} />;
  if (Array.isArray(v)) {
    if (v.every(isScalar)) return <>{v.map((x) => String(x)).join(", ")}</>;
    if (depth >= 1) return <code className="text-xs">{JSON.stringify(v)}</code>;
    return (
      <ul className="list-disc pl-4">
        {v.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: list items have no stable identity
          <li key={i}>
            <Value v={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof v === "object") {
    if (depth >= 1) return <code className="text-xs">{JSON.stringify(v)}</code>;
    return <PreviewRows record={v as Record<string, unknown>} depth={depth + 1} />;
  }
  return null;
}

export function StructuredPreview({ details }: Props): ReactNode {
  if (!details) return null;
  return <PreviewRows record={details} depth={0} />;
}
