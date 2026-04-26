/** ✦ AnimatedCounter — rolls numbers up/down */
import { useState, useEffect, useRef } from 'react';

export default function AnimatedCounter({ value, duration = 400, className = '' }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = typeof prevRef.current === 'number' ? prevRef.current : 0;
    const to = typeof value === 'number' ? value : 0;
    prevRef.current = to;

    if (from === to) { setDisplay(to); return; }

    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      setDisplay(current);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <span className={className}>{typeof value === 'number' ? display : value}</span>;
}
