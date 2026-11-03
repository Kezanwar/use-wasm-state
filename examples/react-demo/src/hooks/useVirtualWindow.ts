import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Which slice of a long list is on screen.
 *
 * The whole of virtualisation, in one number: how far down the scroll
 * container is, divided by a fixed row height. Rows are a constant 32px so
 * there is nothing to measure and nothing to cache; a variable-height grid
 * would need an offset table, which is a different hook.
 *
 * Nothing here knows about the table. It reports a window, and the grid
 * asks the library for exactly those rows.
 */
export interface VirtualWindow {
  /** Attach to the scrolling element. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** First row to render, already including the overscan. */
  start: number;
  /** How many rows to render. */
  count: number;
  /** Height of the full list, so the scrollbar is the right size. */
  totalHeight: number;
  /** How far down to push the rendered rows. */
  offsetY: number;
  /** Scroll so a row is in view, for keyboard navigation. */
  scrollToRow(index: number): void;
}

export function useVirtualWindow(rowCount: number, rowHeight: number, overscan = 8): VirtualWindow {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  // Measured rather than assumed, and re-measured on resize: the grid
  // fills whatever space it is given.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => setHeight(element.clientHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Read from the event rather than from state, so a fast scroll never
  // renders a window it has already left.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onScroll = () => setScrollTop(element.scrollTop);
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  const visible = Math.max(1, Math.ceil(height / rowHeight));

  // The window is snapped to a block rather than tracking the scroll
  // exactly, so dragging the bar asks for the same window for a while
  // instead of a brand new one every frame. That costs a little overscan
  // and saves a request per frame, which in worker mode is a round trip
  // per frame.
  const block = Math.max(1, overscan);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const start = Math.min(Math.max(0, rowCount - 1), Math.floor(first / block) * block);
  const span = (Math.ceil((visible + overscan * 2) / block) + 1) * block;
  const count = Math.max(0, Math.min(rowCount - start, span));

  const scrollToRow = useCallback(
    (index: number) => {
      const element = ref.current;
      if (!element) return;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }
    },
    [rowHeight]
  );

  return {
    ref,
    start,
    count,
    totalHeight: rowCount * rowHeight,
    offsetY: start * rowHeight,
    scrollToRow,
  };
}
