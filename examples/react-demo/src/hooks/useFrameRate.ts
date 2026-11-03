import { useEffect, useState } from "react";

/**
 * Frames per second, sampled once a second.
 *
 * In the status bar because it is the claim the whole library is making: a
 * grid over two hundred thousand rows that does not drop frames while you
 * scroll it.
 */
export function useFrameRate(): number {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let since = performance.now();
    let raf = 0;

    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - since >= 1000) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return fps;
}
