"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/arc/components/button/button";
import { Alert } from "@/components/arc/components/alert/alert";
import Toast from "@/components/arc/components/toast/toast";
import { Progress } from "@/components/arc/components/progress/progress";
import { Skeleton } from "@/components/arc/components/skeleton/skeleton";
import { ToastStack, ToastStackProvider, useToastStack } from "@/components/arc/components/toast-stack/toast-stack";
import { UsageMeter } from "@/components/arc/components/usage-meter/usage-meter";
import { Stepper } from "@/components/arc/components/stepper/stepper";
import { AnnouncementBar } from "@/components/arc/components/announcement-bar/announcement-bar";
import { TextReveal } from "@/components/arc/components/text-reveal/text-reveal";
import { InViewTitle } from "@/components/arc/components/in-view-title/in-view-title";
import { TextMorph } from "@/components/arc/components/text-morph/text-morph";
import { TextShimmer } from "@/components/arc/components/text-shimmer/text-shimmer";
import { SlotText } from "@/components/arc/components/slot-text/slot-text";
import type { ArcDemo } from "./gallery-context";
import styles from "./demos.module.css";

/** Cycles through `values` every `ms`, so motion demos keep moving without a click. */
function useCycle<T>(values: readonly T[], ms: number): [T, () => void] {
  const [index, setIndex] = useState(0);
  const next = () => setIndex((i) => (i + 1) % values.length);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % values.length), ms);
    return () => clearInterval(id);
  }, [values.length, ms]);
  return [values[index], next];
}

function AlertDemo() {
  return (
    <div className={styles.stack}>
      <Alert tone="warning" title="Dealer session expires in 4 minutes">Reconnect before submitting more orders.</Alert>
      <Alert tone="danger" title="Blacklisted IC">The portal refused this customer. No order was created.</Alert>
    </div>
  );
}

function ToastDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Show toast</Button>
      <Toast title="Draft saved" description="ORD-0277 is ready to submit." open={open} onOpenChange={setOpen} />
    </>
  );
}

function ProgressDemo() {
  const [value] = useCycle([18, 47, 76, 100], 1400);
  return <div className={styles.stack}><Progress value={value} label="Submitting · step 9 of 17" showValue /></div>;
}

function SkeletonDemo() {
  return <div className={styles.stack}><Skeleton label="Loading orders" lines={3} avatar /></div>;
}

function ToastStackButtons() {
  const { toast } = useToastStack();
  return (
    <div className={styles.row}>
      <Button variant="secondary" onClick={() => toast({ type: "success", title: "Order submitted", description: "2608000121750632" })}>Success</Button>
      <Button variant="secondary" onClick={() => toast({ type: "error", title: "Submit failed", description: "Device out of stock" })}>Error</Button>
      <Button variant="secondary" onClick={() => toast({ type: "loading", title: "Generating bill…" })}>Loading</Button>
    </div>
  );
}

function ToastStackDemo() {
  return (
    <ToastStackProvider>
      <ToastStackButtons />
      <ToastStack />
    </ToastStackProvider>
  );
}

function UsageMeterDemo() {
  return (
    <div className={styles.stack}>
      <UsageMeter
        label="Case credits"
        limit={1000}
        segments={[{ id: "internet", label: "Umobile bills", value: 412 }, { id: "utility", label: "Utility bills", value: 236 }]}
      />
    </div>
  );
}

function StepperDemo() {
  return (
    <div className={styles.fill}>
      <Stepper
        current={2}
        steps={[
          { id: "customer", label: "Customer", description: "Profile created" },
          { id: "address", label: "Address", description: "Unit selected" },
          { id: "offer", label: "Offer", description: "Choosing a plan" },
          { id: "pay", label: "Pay" },
        ]}
      />
    </div>
  );
}

function AnnouncementBarDemo() {
  return (
    <div className={styles.fill}>
      <AnnouncementBar
        dismissible={false}
        messages={[
          { id: "arc", message: "BizzFlow now has an Arc design — try the toggle in the top bar." },
          { id: "retry", message: "Failed submits now retry automatically, up to three times." },
        ]}
      />
    </div>
  );
}

function TextRevealDemo() {
  const [text] = useCycle(["Every order, one place.", "Crawl, bill, submit."], 3200);
  return <TextReveal key={text} as="h3" text={text} />;
}

function InViewTitleDemo() {
  return <InViewTitle as="h3" variant="blur" text="Orders that finish themselves" once={false} />;
}

function TextMorphDemo() {
  const [label] = useCycle(["Submit", "Submitting", "Submitted"], 1500);
  return <TextMorph as="strong" className={styles.title}>{label}</TextMorph>;
}

function TextShimmerDemo() {
  return <TextShimmer>Reading the OTP from email…</TextShimmer>;
}

function SlotTextDemo() {
  const [value] = useCycle([12480, 12896, 13310, 14022], 1600);
  return <span className={styles.title}><SlotText value={value} /></span>;
}

export const FEEDBACK_TEXT_DEMOS: Record<string, ArcDemo> = {
  alert: AlertDemo,
  toast: ToastDemo,
  progress: ProgressDemo,
  skeleton: SkeletonDemo,
  "toast-stack": ToastStackDemo,
  "usage-meter": UsageMeterDemo,
  stepper: StepperDemo,
  "announcement-bar": AnnouncementBarDemo,
  "text-reveal": TextRevealDemo,
  "in-view-title": InViewTitleDemo,
  "text-morph": TextMorphDemo,
  "text-shimmer": TextShimmerDemo,
  "slot-text": SlotTextDemo,
};
