"use client";

import { createContext, useContext, type ComponentType } from "react";

/** One live example of an Arc item. */
export type ArcDemo = ComponentType;

export interface GalleryState {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

/** Lets the theme-switch demos drive the gallery's own light / dark preview. */
export const GalleryContext = createContext<GalleryState>({ theme: "light", setTheme: () => {} });

export function useGallery(): GalleryState {
  return useContext(GalleryContext);
}

/** Resolves after `ms` — stands in for a network call in async demos. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
