"use client";

import { Bell, FileText, LayoutDashboard, Plus, Settings } from "lucide-react";
import { SignupForm } from "@/components/arc/blocks/signup-form/signup-form";
import { LogoMarquee } from "@/components/arc/blocks/logo-marquee/logo-marquee";
import { PlanComparison } from "@/components/arc/blocks/plan-comparison/plan-comparison";
import { CommandPalette } from "@/components/arc/components/command-palette/command-palette";
import { NotificationCenter } from "@/components/arc/components/notification-center/notification-center";
import { FileUpload } from "@/components/arc/components/file-upload/file-upload";
import { OtpInput } from "@/components/arc/components/otp-input/otp-input";
import { ChangelogFeed } from "@/components/arc/blocks/changelog-feed/changelog-feed";
import { SignIn } from "@/components/arc/blocks/sign-in/sign-in";
import { PageHeader } from "@/components/arc/blocks/page-header/page-header";
import { EmptyStates } from "@/components/arc/blocks/empty-states/empty-states";
import { LoginCentered } from "@/components/arc/blocks/login-centered/login-centered";
import { SiteHeaderBlock } from "@/components/arc/blocks/site-header/site-header";
import { SiteFooterBlock } from "@/components/arc/blocks/site-footer/site-footer";
import { HeroSectionBlock } from "@/components/arc/blocks/hero-section/hero-section";
import { FaqSectionBlock } from "@/components/arc/blocks/faq-section/faq-section";
import { ContactSectionBlock } from "@/components/arc/blocks/contact-section/contact-section";
import { BlogGridBlock } from "@/components/arc/blocks/blog-grid/blog-grid";
import { ComparisonTableBlock } from "@/components/arc/blocks/comparison-table/comparison-table";
import { StatsBandBlock } from "@/components/arc/blocks/stats-band/stats-band";
import { CtaSectionBlock } from "@/components/arc/blocks/cta-section/cta-section";
import { NewsletterSignupBlock } from "@/components/arc/blocks/newsletter-signup/newsletter-signup";
import { person } from "@/components/arc/lib/media";
import { type ArcDemo, wait } from "./gallery-context";
import styles from "./demos.module.css";

function CommandPaletteDemo() {
  return (
    <div className={styles.fill}>
      <CommandPalette
        items={[
          { id: "new", label: "New order", group: "Order Entry", icon: <Plus size={16} />, shortcut: "N" },
          { id: "orders", label: "Orders", group: "Order Entry", icon: <FileText size={16} /> },
          { id: "dash", label: "Dashboard", group: "Navigate", icon: <LayoutDashboard size={16} /> },
          { id: "settings", label: "Settings", group: "Navigate", icon: <Settings size={16} /> },
          { id: "notify", label: "Notification email", group: "Settings", icon: <Bell size={16} />, keywords: ["resend", "mail"] },
        ]}
      />
    </div>
  );
}

function NotificationCenterDemo() {
  const lead = person("nathan-cole");
  return (
    <NotificationCenter
      notifications={[
        { id: "1", title: "ORD-0276 submitted", description: "Order 2608000121750632", time: "2m", tone: "success" },
        { id: "2", title: "ORD-0275 failed", description: "Address already has TM services", time: "18m", tone: "warning" },
        { id: "3", title: "Plan published", description: "Unifi Home 300Mbps", time: "1h", read: true, actor: { name: lead.name, photo: lead.src } },
      ]}
    />
  );
}

function FileUploadDemo() {
  return (
    <div className={styles.fill}>
      <FileUpload
        label="ID copy"
        description="JPG, PNG or PDF up to 5 MB"
        accept="image/*,application/pdf"
        maxSize={5 * 1024 * 1024}
        onUpload={async (_file, { onProgress }) => { for (let p = 25; p <= 100; p += 25) { await wait(200); onProgress(p); } }}
      />
    </div>
  );
}

function OtpInputDemo() {
  return <OtpInput label="Dealer OTP" />;
}

function HeroSectionDemo() {
  return <HeroSectionBlock />;
}

function SiteHeaderDemo() {
  return <SiteHeaderBlock />;
}

function SiteFooterDemo() {
  return <SiteFooterBlock />;
}

function FaqSectionDemo() {
  return <FaqSectionBlock />;
}

function ContactSectionDemo() {
  return <ContactSectionBlock />;
}

export const BLOCK_DEMOS: Record<string, ArcDemo> = {
  "signup-form": SignupForm,
  "logo-marquee": LogoMarquee,
  "plan-comparison": PlanComparison,
  "command-palette": CommandPaletteDemo,
  "notification-center": NotificationCenterDemo,
  "file-upload": FileUploadDemo,
  "otp-input": OtpInputDemo,
  "changelog-feed": ChangelogFeed,
  "sign-in": SignIn,
  "page-header": PageHeader,
  "empty-states": EmptyStates,
  "login-centered": LoginCentered,
  "site-header": SiteHeaderDemo,
  "site-footer": SiteFooterDemo,
  "hero-section": HeroSectionDemo,
  "faq-section": FaqSectionDemo,
  "contact-section": ContactSectionDemo,
  "blog-grid": BlogGridBlock,
  "comparison-table": ComparisonTableBlock,
  "stats-band": StatsBandBlock,
  "cta-section": CtaSectionBlock,
  "newsletter-signup": NewsletterSignupBlock,
};
