"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_ACCENT,
  DEFAULT_DESIGN,
  readAccent,
  readDesign,
  subscribeDesign,
  type ArcAccent,
  type Design,
} from "@/lib/design";

/** The design on <html>. Server render reports the default; the client corrects it on hydration. */
export function useDesign(): { design: Design; accent: ArcAccent } {
  const design = useSyncExternalStore(subscribeDesign, readDesign, () => DEFAULT_DESIGN);
  const accent = useSyncExternalStore(subscribeDesign, readAccent, () => DEFAULT_ACCENT);
  return { design, accent };
}

/** True while the app renders the Arc design. Every switching primitive in src/components/ui reads this. */
export function useIsArc(): boolean {
  return useSyncExternalStore(subscribeDesign, readDesign, () => DEFAULT_DESIGN) === "arc";
}
