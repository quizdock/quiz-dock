import { useEffect, useState } from 'react';

/**
 * A value that follows another once it stopped changing for `ms`: a search
 * sent when the typing pauses, not at each key.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
