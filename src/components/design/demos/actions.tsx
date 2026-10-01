"use client";

import { useState } from "react";
import { Archive, Download, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/arc/components/button/button";
import { ActionButton } from "@/components/arc/components/action-button/action-button";
import { SplitButton } from "@/components/arc/components/split-button/split-button";
import { DropdownMenu } from "@/components/arc/components/dropdown-menu/dropdown-menu";
import { ContextMenu, contextMenuExampleItems } from "@/components/arc/components/context-menu/context-menu";
import { CopyButton } from "@/components/arc/components/copy-button/copy-button";
import { ThemeSwitch, type ThemeSwitchVariant } from "@/components/arc/components/theme-switch/theme-switch";
import { HoldToConfirm } from "@/components/arc/components/hold-to-confirm/hold-to-confirm";
import { SwipeActions, SwipeActionsRow } from "@/components/arc/components/swipe-actions/swipe-actions";
import { UserMenu } from "@/components/arc/components/user-menu/user-menu";
import { ConfirmMorph } from "@/components/arc/components/confirm-morph/confirm-morph";
import { type ArcDemo, useGallery, wait } from "./gallery-context";
import styles from "./demos.module.css";

function ButtonDemo() {
  const [loading, setLoading] = useState(false);
  return (
    <div className={styles.row}>
      <Button>Submit order</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Delete</Button>
      <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600); }}>
        {loading ? "Submitting" : "Try loading"}
      </Button>
    </div>
  );
}

function ActionButtonDemo() {
  return <ActionButton label="Generate bill" pendingLabel="Generating" successLabel="Bill ready" onAction={() => wait(1200)} />;
}

function SplitButtonDemo() {
  return (
    <SplitButton
      label="Submit"
      actions={[
        { label: "Submit and stop before Pay", icon: <Send size={16} /> },
        { label: "Save as draft", icon: <Pencil size={16} /> },
        { label: "Discard", icon: <Trash2 size={16} />, destructive: true },
      ]}
    />
  );
}

function DropdownMenuDemo() {
  return (
    <DropdownMenu
      label="Order actions"
      items={[
        { label: "Edit draft", icon: <Pencil size={16} /> },
        { label: "Download e-RF", icon: <Download size={16} /> },
        { label: "Archive", icon: <Archive size={16} /> },
        { label: "Delete", icon: <Trash2 size={16} />, destructive: true, separatorBefore: true },
      ]}
    />
  );
}

function ContextMenuDemo() {
  return (
    <ContextMenu items={contextMenuExampleItems}>
      <div className={styles.target}>Right-click or long-press here</div>
    </ContextMenu>
  );
}

function CopyButtonDemo() {
  return <CopyButton value="2608000121750632" label="Copy order number" />;
}

function themeSwitchDemo(variant: ThemeSwitchVariant): ArcDemo {
  function ThemeSwitchDemo() {
    const { theme, setTheme } = useGallery();
    return <ThemeSwitch theme={theme} variant={variant} onThemeChange={(next) => setTheme(next)} />;
  }
  return ThemeSwitchDemo;
}

function HoldToConfirmDemo() {
  const [done, setDone] = useState(false);
  return (
    <HoldToConfirm
      label="Hold to void order"
      confirmedLabel="Voided"
      tone="danger"
      confirmed={done}
      onConfirm={() => { setDone(true); setTimeout(() => setDone(false), 2000); }}
    />
  );
}

function SwipeActionsDemo() {
  return (
    <div className={styles.fill}>
      <SwipeActions label="Orders">
        {["ORD-0275 · Lin Chin Chean", "ORD-0276 · Wojak Lang"].map((row) => (
          <SwipeActionsRow
            key={row}
            label={row}
            leading={[{ label: "Archive", icon: <Archive size={18} />, tone: "accent", onSelect: () => {} }]}
            trailing={[{ label: "Delete", icon: <Trash2 size={18} />, tone: "danger", onSelect: () => {} }]}
          >
            <div className={styles.swipeRow}>{row}</div>
          </SwipeActionsRow>
        ))}
      </SwipeActions>
    </div>
  );
}

function UserMenuDemo() {
  return <UserMenu user={{ name: "Aiboot Agent", email: "agent@bizzflow.top", plan: "Order Entry" }} onSignOut={() => wait(600)} />;
}

function ConfirmMorphDemo() {
  return <ConfirmMorph label="Cancel order" prompt="Cancel this order?" tone="danger" onConfirm={() => wait(900)} onUndo={() => wait(500)} />;
}

export const ACTION_DEMOS: Record<string, ArcDemo> = {
  button: ButtonDemo,
  "action-button": ActionButtonDemo,
  "split-button": SplitButtonDemo,
  "dropdown-menu": DropdownMenuDemo,
  "context-menu": ContextMenuDemo,
  "copy-button": CopyButtonDemo,
  "theme-switch": themeSwitchDemo("reveal"),
  "theme-switch-eclipse": themeSwitchDemo("eclipse"),
  "theme-switch-split": themeSwitchDemo("split"),
  "theme-switch-rise": themeSwitchDemo("rise"),
  "hold-to-confirm": HoldToConfirmDemo,
  "swipe-actions": SwipeActionsDemo,
  "user-menu": UserMenuDemo,
  "confirm-morph": ConfirmMorphDemo,
};
