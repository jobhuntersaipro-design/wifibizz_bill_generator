"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A one-shot CSS class when a value CHANGES — the row that just moved is the
 * row worth glancing at.
 *
 * Fires only on a real change after the first render: mounting is not a change,
 * and flashing every row on load would say "everything just changed", which
 * says nothing. The class self-clears so the same row can flash again on the
 * next change.
 */
export function useFlashOnChange<T>(value: T, className: string): string {
  const prev = useRef<T | null>(null);
  const mounted = useRef(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prev.current = value;
      return;
    }
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    // Deferred a frame: setState synchronously inside an effect cascades
    // renders (lint: react-hooks/set-state-in-effect), and a flash that starts
    // one frame late is indistinguishable to the eye.
    const raf = requestAnimationFrame(() => setFlash(true));
    const t = setTimeout(() => setFlash(false), 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [value]);

  return flash ? className : "";
}
