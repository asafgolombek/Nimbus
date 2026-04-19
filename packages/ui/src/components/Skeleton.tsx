import type { CSSProperties, PropsWithChildren } from "react";

export function Skeleton({
  width,
  height,
  children,
}: PropsWithChildren<{ width?: string; height?: string }>) {
  const style: CSSProperties = {
    width: width ?? "100%",
    height: height ?? "1rem",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    opacity: 0.5,
  };
  return (
    <div aria-busy="true" style={style}>
      {children}
    </div>
  );
}
