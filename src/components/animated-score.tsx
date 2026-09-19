import { useEffect, useRef, useState } from "react";

/**
 * Shows a score that counts up smoothly and pops a "+N" badge whenever it grows.
 */
export function AnimatedScore({
  value,
  suffix = "",
  className = "",
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const [gain, setGain] = useState<{ id: number; amount: number } | null>(null);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    if (value > from) setGain({ id: Date.now(), amount: value - from });

    const start = performance.now();
    const duration = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value]);

  useEffect(() => {
    if (!gain) return;
    const timer = window.setTimeout(() => setGain(null), 1100);
    return () => window.clearTimeout(timer);
  }, [gain]);

  return (
    <span className={`relative inline-flex items-center tabular-nums ${className}`}>
      <span className={gain ? "score-bump text-primary" : undefined}>
        {display}
        {suffix}
      </span>
      {gain && (
        <span
          key={gain.id}
          className="score-gain pointer-events-none absolute -top-1 right-0 font-display text-xs font-bold text-primary"
        >
          +{gain.amount}
        </span>
      )}
    </span>
  );
}
