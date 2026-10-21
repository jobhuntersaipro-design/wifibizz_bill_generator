/**
 * setInterval that skips ticks while the tab is hidden, and runs once when it
 * becomes visible again. A forgotten background tab polling every few seconds
 * keeps the Neon compute awake all night; a hidden tab needs no fresh data.
 * Returns the cleanup for a useEffect.
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const tick = () => {
    if (!document.hidden) fn();
  };
  const id = setInterval(tick, ms);
  document.addEventListener("visibilitychange", tick);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", tick);
  };
}
