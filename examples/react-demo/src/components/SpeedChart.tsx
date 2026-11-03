import { useState } from "react";
import { cn } from "cn";
import type { ImplId, Results } from "@/bench/runner";
import { formatFactor, formatMs } from "@/bench/format";
import { LABELS } from "@/bench/implementations";

/**
 * Speed against typical JS, one row per operation, on one log axis.
 *
 * Typical JS is the 1× line. A bar to the right is that many times faster,
 * a bar to the left that many times slower, so where JS wins is as visible
 * as where it loses. Milliseconds on one axis would flatten every quick
 * operation into nothing; a ratio is the comparison the chart is for, and
 * the table beside it carries the times.
 */

/**
 * A browser clamps performance.now() to tens of microseconds, so an
 * operation quicker than that can time as zero. A ratio against zero is
 * infinite, so every median is floored here, well below anything real.
 */
const FLOOR_MS = 1e-4;

const SERIES: { id: Exclude<ImplId, "typical">; color: string }[] = [
  { id: "wasm", color: "var(--series-wasm)" },
  { id: "tuned", color: "var(--series-tuned)" },
];

export function SpeedChart({ results }: { results: Results }) {
  const [hovered, setHovered] = useState<{ op: string; id: ImplId } | null>(null);

  const rows = results.operations.map((op) => {
    const base = Math.max(FLOOR_MS, op.results.typical.median);
    return {
      op,
      factors: Object.fromEntries(
        SERIES.map(({ id }) => [id, base / Math.max(FLOOR_MS, op.results[id].median)])
      ) as Record<string, number>,
    };
  });

  const all = rows.flatMap((row) => Object.values(row.factors));
  const lo = Math.min(0.1, 10 ** Math.floor(Math.log10(Math.min(...all))));
  const hi = Math.max(10, 10 ** Math.ceil(Math.log10(Math.max(...all))));
  const x = (factor: number) =>
    ((Math.log10(factor) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100;
  const one = x(1);
  // From exponents, so 0.1 × 10 is 1 and not 1.0000000000000002.
  const ticks: number[] = [];
  for (let e = Math.log10(lo); e <= Math.log10(hi) && ticks.length < 12; e++) ticks.push(10 ** e);

  return (
    <figure className="space-y-3" data-testid="speed-chart">
      <figcaption className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {SERIES.map(({ id, color }) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color }} />
            {LABELS[id]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="bg-foreground/50 h-3 w-px" />
          {LABELS.typical}
        </span>
      </figcaption>

      <div className="grid grid-cols-[minmax(6rem,9rem)_1fr] gap-x-3 text-xs">
        {rows.map(({ op, factors }) => (
          <div key={op.id} className="contents">
            <div className="text-muted-foreground flex h-7 items-center truncate">{op.label}</div>
            <div className="relative h-7">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="bg-border absolute inset-y-0 w-px"
                  style={{ left: `${x(t)}%` }}
                />
              ))}
              <span
                className="bg-foreground/50 absolute inset-y-0 w-px"
                style={{ left: `${one}%` }}
              />
              {SERIES.map(({ id, color }, i) => {
                const end = x(factors[id]!);
                const faster = end >= one;
                const active = hovered?.op === op.id && hovered.id === id;
                return (
                  // The hit target is the bar's own band, a little taller
                  // than the 7px mark, so the two never compete for a hover.
                  <div
                    key={id}
                    className="absolute h-[11px] cursor-default"
                    style={{
                      top: 3 + i * 11,
                      left: `${Math.min(one, end)}%`,
                      width: `${Math.max(Math.abs(end - one), 0.6)}%`,
                    }}
                    onMouseEnter={() => setHovered({ op: op.id, id })}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span
                      className={cn(
                        "absolute top-[2px] right-0 left-0 h-[7px]",
                        faster ? "rounded-r" : "rounded-l"
                      )}
                      style={{ background: color }}
                    />
                    {active && (
                      <span
                        role="tooltip"
                        className="bg-popover text-popover-foreground absolute z-10 whitespace-nowrap rounded-md border px-2 py-1 shadow-sm"
                        style={{
                          bottom: "100%",
                          [faster ? "right" : "left"]: 0,
                          marginBottom: 4,
                        }}
                      >
                        {LABELS[id]} {formatMs(op.results[id].median)} ·{" "}
                        {formatFactor(factors[id]!)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div />
        <div className="text-muted-foreground relative h-5">
          {ticks.map((t) => (
            <span
              key={t}
              className="tabular absolute -translate-x-1/2 pt-1"
              style={{ left: `${x(t)}%` }}
            >
              {t}×
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
