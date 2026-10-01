/**
 * Which design the app renders in: today's Stripe-style "classic", or Arc (uiarc.dev).
 *
 * The choice is a per-viewer preference, so it lives in localStorage and is
 * applied as data-design / data-accent on <html> by an inline script that runs
 * before first paint — reading a cookie in the root layout instead would turn
 * every route dynamic just to pick a stylesheet.
 */
export const DESIGNS = ["classic", "arc"] as const;
export type Design = (typeof DESIGNS)[number];

/** Arc accents whose foreground is white, so `text-white` on a brand fill stays legible. */
export const ARC_ACCENTS = ["neutral", "violet", "blue"] as const;
export type ArcAccent = (typeof ARC_ACCENTS)[number];

export const DESIGN_STORAGE_KEY = "bf-design";
export const ACCENT_STORAGE_KEY = "bf-arc-accent";
export const DEFAULT_DESIGN: Design = "classic";
export const DEFAULT_ACCENT: ArcAccent = "neutral";
const CHANGE_EVENT = "bf-design-change";

export function isDesign(value: unknown): value is Design {
  return typeof value === "string" && (DESIGNS as readonly string[]).includes(value);
}

export function isArcAccent(value: unknown): value is ArcAccent {
  return typeof value === "string" && (ARC_ACCENTS as readonly string[]).includes(value);
}

/**
 * Runs in <head> before the body paints. Kept dependency-free and wrapped in
 * try/catch: storage can throw (private mode, blocked site data) and a failure
 * here must leave the classic design, never a blank page.
 */
export const DESIGN_INIT_SCRIPT = `(function(){try{var d=localStorage.getItem(${JSON.stringify(
  DESIGN_STORAGE_KEY,
)}),a=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)}),r=document.documentElement;if(d===${JSON.stringify(
  "arc",
)}){r.setAttribute("data-design","arc");r.setAttribute("data-accent",${JSON.stringify(
  ARC_ACCENTS,
)}.indexOf(a)>-1?a:${JSON.stringify(DEFAULT_ACCENT)});}}catch(e){}})();`;

function root(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

export function readDesign(): Design {
  const value = root()?.getAttribute("data-design");
  return isDesign(value) ? value : DEFAULT_DESIGN;
}

export function readAccent(): ArcAccent {
  const value = root()?.getAttribute("data-accent");
  return isArcAccent(value) ? value : DEFAULT_ACCENT;
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
}

export function applyDesign(design: Design, accent: ArcAccent = readAccent()) {
  const el = root();
  if (!el) return;
  if (design === "arc") {
    el.setAttribute("data-design", "arc");
    el.setAttribute("data-accent", accent);
  } else {
    el.removeAttribute("data-design");
    el.removeAttribute("data-accent");
  }
  store(DESIGN_STORAGE_KEY, design);
  store(ACCENT_STORAGE_KEY, accent);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore: fires on our own changes and on another tab's. */
export function subscribeDesign(onChange: () => void): () => void {
  // Another tab changed the choice: follow it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== DESIGN_STORAGE_KEY && e.key !== ACCENT_STORAGE_KEY) return;
    try {
      const design = localStorage.getItem(DESIGN_STORAGE_KEY);
      const accent = localStorage.getItem(ACCENT_STORAGE_KEY);
      applyDesign(isDesign(design) ? design : DEFAULT_DESIGN, isArcAccent(accent) ? accent : DEFAULT_ACCENT);
    } catch {
      // Storage blocked: nothing to follow.
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
