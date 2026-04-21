export interface PanelErrorProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function PanelError({ message, onRetry }: PanelErrorProps) {
  return (
    <div className="p-4 rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)]">
      <p className="text-sm text-[var(--color-danger-text)]">{message}</p>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 px-3 py-1 text-sm rounded border border-[var(--color-danger-border)]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
