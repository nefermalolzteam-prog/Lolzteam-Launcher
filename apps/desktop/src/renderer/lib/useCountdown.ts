import { useEffect, useState } from 'react';

/** Сколько секунд осталось — от `seconds` до нуля, один раз. */
export const useCountdown = (seconds: number): number => {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil(seconds)));

  useEffect(() => {
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    const id = window.setInterval(() => {
      const rest = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(rest);
      if (rest === 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [seconds]);

  return left;
};
