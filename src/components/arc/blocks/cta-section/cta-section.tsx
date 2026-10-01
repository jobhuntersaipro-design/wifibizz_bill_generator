"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/arc/components/button/button";
import SegmentedControl from "@/components/arc/components/segmented-control/segmented-control";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { ctaCopy, ctaFaces, ctaSetup, type CtaAction } from "./cta-section-data";
import styles from "./cta-section.module.css";

export type { CtaAction } from "./cta-section-data";
export type CtaVariant = "centered" | "split" | "banner";

export interface CtaSectionProps {
  /** `centered` is a closing section, `split` sits beside a product visual, `banner` is one dismissible line. */
  variant?: CtaVariant;
  title?: string;
  description?: string;
  primaryAction?: CtaAction;
  /** Not shown in the banner variant. Pass null to hide it. */
  secondaryAction?: CtaAction | null;
  /** Small print under the actions in the centered variant, such as "No credit card required". */
  note?: string;
  /** Faces beside the note in the centered variant. Pass an empty array to hide them. */
  faces?: string[];
  /** Short benefit lines in the split variant. */
  points?: string[];
  /** Replaces the split variant's setup card. */
  visual?: ReactNode;
  /** Banner only: shows a dismiss button and calls this after it closes. */
  onDismiss?: () => void;
  className?: string;
}

type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;

/** A link, a callback, or (with neither) a button that confirms in place, so previews always answer a click. */
function Action({ action, variant, size = "lg", arrow }: { action: CtaAction; variant: "primary" | "secondary"; size?: "sm" | "md" | "lg"; arrow?: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  if (action.href) {
    return <a className={styles.linkAction} data-variant={variant} data-size={size} href={action.href}>
      {action.label}{arrow && <ArrowRight className={styles.arrow} size={16} strokeWidth={2} aria-hidden="true" />}
    </a>;
  }
  const simulated = !action.onClick;
  return <Button
    className={styles.action}
    variant={variant}
    size={size}
    aria-live={simulated ? "polite" : undefined}
    onClick={() => { if (action.onClick) action.onClick(); else setConfirmed(value => !value); }}
  >
    {confirmed
      ? <><Check size={16} strokeWidth={2.25} aria-hidden="true" />{action.confirmedLabel ?? action.label}</>
      : <>{action.label}{arrow && <ArrowRight className={styles.arrow} size={16} strokeWidth={2} aria-hidden="true" />}</>}
  </Button>;
}

/** A setup card that ticks through its steps once it scrolls into view. */
function SetupVisual({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: .5 });
  const total = ctaSetup.steps.length;
  const [step, setStep] = useState(0);
  const shown = reduced ? total : step;

  useEffect(() => {
    if (!inView || reduced) return;
    const timers = ctaSetup.steps.map((_, index) => window.setTimeout(() => setStep(index + 1), 520 + index * 620));
    return () => timers.forEach(window.clearTimeout);
  }, [inView, reduced]);

  return <div ref={ref} className={styles.setup} aria-hidden="true" data-done={shown === total ? "" : undefined}>
    <div className={styles.setupHead}>
      <span className={styles.workspaceMark}>{ctaSetup.workspace.charAt(0)}</span>
      <span className={styles.setupTitle}>{ctaSetup.workspace}</span>
      <span className={styles.setupStatus}>
        <span data-shown={shown < total ? "" : undefined}>Setting up</span>
        <span data-shown={shown === total ? "" : undefined}>Ready</span>
      </span>
    </div>
    <div className={styles.progress}><span style={{ transform: `scaleX(${shown / total})` }} /></div>
    <ol className={styles.steps}>
      {ctaSetup.steps.map((label, index) => {
        const done = index < shown;
        return <li key={label} className={styles.step} data-done={done ? "" : undefined} data-active={index === shown ? "" : undefined}>
          <span className={styles.stepMark}><Check size={12} strokeWidth={2.75} /></span>
          <span className={styles.stepLabel}>{label}</span>
          {index === total - 1 && <span className={styles.stepFaces}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {ctaSetup.faces.map((src, face) => <img key={src} src={src} alt="" width={22} height={22} style={{ transitionDelay: `${face * 60}ms` }} />)}
          </span>}
        </li>;
      })}
    </ol>
  </div>;
}

function Faces({ faces }: { faces: string[] }) {
  if (!faces.length) return null;
  return <span className={styles.faces} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {faces.slice(0, 4).map(src => <img key={src} src={src} alt="" width={26} height={26} />)}
  </span>;
}

/**
 * A call to action in three shapes: a centered closing section, a split layout beside a setup card that completes
 * itself in view, and a compact banner that closes its gap when dismissed.
 */
export const CtaSection = forwardRef<HTMLElement, CtaSectionProps>(function CtaSection({
  variant = "centered",
  title,
  description,
  primaryAction,
  secondaryAction,
  note,
  faces = ctaFaces,
  points,
  visual,
  onDismiss,
  className,
}, ref) {
  const id = useId();
  const reduced = !!useReducedMotion();
  const [open, setOpen] = useState(true);
  const copy = ctaCopy[variant];
  const heading = title ?? copy.title;
  const text = description ?? copy.description;
  const primary = primaryAction ?? copy.primary;
  const secondary = secondaryAction === null ? null : secondaryAction ?? ("secondary" in copy ? copy.secondary : undefined);
  const classes = [styles.cta, className].filter(Boolean).join(" ");

  if (variant === "banner") {
    return <section ref={ref} className={classes} data-variant="banner" aria-labelledby={`${id}-title`}>
      <AnimatePresence initial={false} onExitComplete={onDismiss}>
        {open && <motion.div
          key="banner"
          className={styles.bannerWrap}
          exit={reduced ? { opacity: 0, transition: { duration: .12 } } : { opacity: 0, height: 0, scale: .98, transition: { height: motionTokens.spring.smooth, scale: { duration: .2, ease: standard }, opacity: { duration: .16, ease: standard } } }}
        >
          <div className={styles.bannerPad}><div className={styles.banner}>
            <p className={styles.bannerText}>
              <strong id={`${id}-title`}>{heading}</strong>
              <span>{text}</span>
            </p>
            <div className={styles.bannerActions}>
              <Action action={primary} variant="primary" size="sm" arrow />
              {onDismiss !== undefined && <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={() => setOpen(false)}>
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>}
            </div>
          </div></div>
        </motion.div>}
      </AnimatePresence>
    </section>;
  }

  if (variant === "split") {
    const list = points ?? ctaCopy.split.points;
    return <section ref={ref} className={classes} data-variant="split" aria-labelledby={`${id}-title`}>
      <div className={styles.split}>
        <div className={styles.splitCopy}>
          <h2 id={`${id}-title`} className={styles.title}>{heading}</h2>
          <p className={styles.description}>{text}</p>
          {list.length > 0 && <ul className={styles.points}>
            {list.map(point => <li key={point}><Check size={16} strokeWidth={2} aria-hidden="true" />{point}</li>)}
          </ul>}
          <div className={styles.actions}>
            <Action action={primary} variant="primary" arrow />
            {secondary && <Action action={secondary} variant="secondary" />}
          </div>
        </div>
        <motion.div
          className={styles.stage}
          initial={reduced ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: .35 }}
          transition={{ duration: .7, ease: enter }}
        >
          {visual ?? <SetupVisual reduced={reduced} />}
        </motion.div>
      </div>
    </section>;
  }

  const small = note ?? ctaCopy.centered.note;
  return <section ref={ref} className={classes} data-variant="centered" aria-labelledby={`${id}-title`}>
    <div className={styles.centeredWrap}>
      <div className={styles.centered}>
        <h2 id={`${id}-title`} className={styles.title}>{heading}</h2>
        <p className={styles.description}>{text}</p>
        <div className={styles.actions}>
          <Action action={primary} variant="primary" arrow />
          {secondary && <Action action={secondary} variant="secondary" />}
        </div>
        {(small || faces.length > 0) && <p className={styles.note}><Faces faces={faces} />{small}</p>}
      </div>
    </div>
  </section>;
});

CtaSection.displayName = "CtaSection";

const variantOptions = [{ value: "centered", label: "Centered" }, { value: "split", label: "Split" }, { value: "banner", label: "Banner" }];

/** Preview: all three shapes. Buttons confirm in place; nothing is sent. */
export function CtaSectionBlock() {
  const [variant, setVariant] = useState<CtaVariant>("centered");
  const [dismissed, setDismissed] = useState(false);
  return <div className={styles.preview}>
    <SegmentedControl label="Call to action layout" options={variantOptions} value={variant} onValueChange={next => { setVariant(next as CtaVariant); setDismissed(false); }} />
    <div className={styles.frame}>
      {variant === "banner" && dismissed
        ? <div className={styles.restore}><Button variant="secondary" size="sm" onClick={() => setDismissed(false)}>Show the banner again</Button></div>
        : <CtaSection key={variant} variant={variant} onDismiss={variant === "banner" ? () => setDismissed(true) : undefined} />}
    </div>
  </div>;
}

export default CtaSectionBlock;
