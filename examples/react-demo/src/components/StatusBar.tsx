import { formatCount, formatMs } from "@/lib/format";

export interface StatusBarProps {
  rowCount: number;
  revision: number;
  fps: number;
  lastMs: number | null;
}

/**
 * Four numbers. The formats carry their own meaning, so none of them is
 * labelled: a count, a revision, a frame rate, a duration. The frame rate
 * is blank until it has a full second to report.
 */
export function StatusBar({ rowCount, revision, fps, lastMs }: StatusBarProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t px-3 font-mono text-xs text-muted-foreground tabular">
      <span data-testid="row-count">{formatCount(rowCount)}</span>
      <span data-testid="revision">r{revision}</span>
      <span className="ml-auto" data-testid="fps">
        {fps === 0 ? "" : `${fps} fps`}
      </span>
      <span data-testid="last-ms" className="w-16 text-right">
        {lastMs === null ? "" : formatMs(lastMs)}
      </span>
    </footer>
  );
}
