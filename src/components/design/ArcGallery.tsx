"use client";

import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { previewArc, restoreStoredDesign } from "@/lib/design";
import { ARC_CATEGORY_LABELS, ARC_ITEMS, type ArcCategory, type ArcItem } from "./arc-catalog";
import { ARC_DEMOS } from "./demos";
import { GalleryContext } from "./demos/gallery-context";
import styles from "./ArcGallery.module.css";

const ACCENTS = ["neutral", "violet", "blue", "green", "amber", "orange", "coral", "rose"] as const;
type Accent = (typeof ACCENTS)[number];
type Filter = "all" | ArcCategory;
const CATEGORIES = Object.keys(ARC_CATEGORY_LABELS) as ArcCategory[];

/**
 * Every Arc (uiarc.dev) component and block, live.
 *
 * Arc is previewed on the whole document while this is open (see previewArc) and the
 * viewer's own design choice comes back on leave. Demos mount when scrolled near, so
 * 122 motion components never start at once, and each sits behind its own error
 * boundary so one failing demo cannot blank the page.
 */
export function ArcGallery() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [accent, setAccent] = useState<Accent>("neutral");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    previewArc(accent, theme);
  }, [accent, theme]);
  useEffect(() => restoreStoredDesign, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ARC_ITEMS.filter((item) =>
      (filter === "all" || item.category === filter) &&
      (!q || `${item.title} ${item.name} ${item.description}`.toLowerCase().includes(q)),
    );
  }, [query, filter]);
  const components = visible.filter((item) => item.kind === "component");
  const blocks = visible.filter((item) => item.kind === "block");
  const context = useMemo(() => ({ theme, setTheme }), [theme]);

  return (
    <GalleryContext.Provider value={context}>
      <div className={styles.gallery} data-design="arc" data-accent={accent} data-theme={theme}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.heading}>Arc design system</h1>
            <p className={styles.lede}>
              All {ARC_ITEMS.filter((i) => i.kind === "component").length} components and {ARC_ITEMS.filter((i) => i.kind === "block").length} blocks
              from <a href="https://uiarc.dev" target="_blank" rel="noreferrer">uiarc.dev</a>, live. This page always previews Arc; the
              Classic / Arc switch in the top bar sets the rest of the app.
            </p>
          </div>
          <div className={styles.controls}>
            <input
              className={styles.search}
              type="search"
              placeholder="Search components"
              aria-label="Search components"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.swatches} role="group" aria-label="Accent">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={styles.swatch}
                  data-swatch={a}
                  aria-pressed={accent === a}
                  aria-label={`${a} accent`}
                  title={a}
                  onClick={() => setAccent(a)}
                />
              ))}
            </div>
            <button type="button" className={styles.chip} aria-pressed={theme === "dark"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "Dark" : "Light"}
            </button>
          </div>
          <nav className={styles.filters} aria-label="Categories">
            <FilterChip label={`All · ${ARC_ITEMS.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
            {CATEGORIES.map((c) => (
              <FilterChip
                key={c}
                label={`${ARC_CATEGORY_LABELS[c]} · ${ARC_ITEMS.filter((i) => i.category === c).length}`}
                active={filter === c}
                onClick={() => setFilter(c)}
              />
            ))}
          </nav>
        </header>

        {visible.length === 0 && <p className={styles.empty}>Nothing matches “{query}”.</p>}
        {components.length > 0 && (
          <section className={styles.grid} aria-label="Components">
            {components.map((item) => <ItemCard key={item.name} item={item} />)}
          </section>
        )}
        {blocks.length > 0 && (
          <section className={styles.blocks} aria-label="Blocks">
            <h2 className={styles.sectionTitle}>Blocks</h2>
            {blocks.map((item) => <ItemCard key={item.name} item={item} />)}
          </section>
        )}
      </div>
    </GalleryContext.Provider>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={styles.chip} aria-pressed={active} onClick={onClick}>{label}</button>;
}

function ItemCard({ item }: { item: ArcItem }) {
  const Demo = ARC_DEMOS[item.name];
  return (
    <article className={styles.card} data-kind={item.kind} id={`arc-${item.name}`}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{item.title}</h3>
        <span className={styles.tag}>{ARC_CATEGORY_LABELS[item.category]}</span>
      </div>
      <p className={styles.cardDescription}>{item.description}</p>
      <div className={styles.stage}>
        <WhenNear>
          <DemoBoundary name={item.title}>{Demo ? <Demo /> : <p className={styles.empty}>No demo.</p>}</DemoBoundary>
        </WhenNear>
      </div>
      <code className={styles.install}>npx shadcn@latest add @uiarc/{item.name}</code>
    </article>
  );
}

/** Mounts its children the first time they come within 600px of the viewport, then keeps them. */
function WhenNear({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setNear(true);
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  return <div ref={ref} className={styles.near}>{near ? children : null}</div>;
}

/**
 * React offers error boundaries only as class components; this is the one class in
 * the codebase, kept to its two required methods.
 */
class DemoBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Arc demo "${this.props.name}" failed`, error, info.componentStack);
  }
  render() {
    return this.state.failed ? <p className={styles.empty}>This demo failed to render.</p> : this.props.children;
  }
}
