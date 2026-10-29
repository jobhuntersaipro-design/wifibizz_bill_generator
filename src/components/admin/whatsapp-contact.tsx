"use client";

import Link from "next/link";
import { CopyButton } from "@/components/arc/components/copy-button/copy-button";
import { InlineEdit } from "@/components/arc/components/inline-edit/inline-edit";
import { Badge } from "@/components/arc/components/badge/badge";
import { ContactAvatar } from "@/components/admin/whatsapp-avatar";
import type { WhatsappContact } from "@/actions/whatsapp";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";

/** BizzFlow orders and cases that carry this WhatsApp number. Read-only. */
export function WhatsappContactPanel({
  waId,
  name,
  namedByAdmin = false,
  photo = false,
  onRename,
  contact,
  crm,
}: {
  waId: string | null;
  name?: string | null;
  /** The shown name was typed by an admin. */
  namedByAdmin?: boolean;
  photo?: boolean;
  /** Saves the admin's name; blank goes back to the WhatsApp name. */
  onRename?: (name: string) => Promise<void>;
  contact: WhatsappContact | string | undefined;
  /** Stage / folder / tag controls for the open chat. */
  crm?: React.ReactNode;
}) {
  if (!waId) return <p className="p-4 text-sm text-ink-muted">Select a chat to see the contact.</p>;
  return (
    <div className="p-4">
      <div className="flex flex-col items-center text-center">
        <ContactAvatar waId={waId} name={name ?? null} photo={photo} size="xl" />
        <div className="mt-3 w-full">
          {onRename ? (
            <InlineEdit
              key={waId}
              as="h2"
              label="Contact name"
              value={name ?? ""}
              placeholder="Add a name"
              onSave={onRename}
              validate={(next) => (next.trim().length > 120 ? "Names are limited to 120 characters." : null)}
            />
          ) : (
            <h2 className="text-base font-semibold text-ink">{name ?? "No name"}</h2>
          )}
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {namedByAdmin ? "Name set by admin · clear it to use the WhatsApp name" : name ? "WhatsApp name" : "WhatsApp sent no name. Click to add one."}
          </p>
        </div>
        <div className="mt-2 flex items-center gap-1">
          <span className="text-sm tabular-nums text-ink">+{waId}</span>
          <CopyButton value={`+${waId}`} label="Copy number" iconOnly variant="plain" />
        </div>
      </div>
      {crm && <div className="mt-5 border-t border-line pt-4">{crm}</div>}
      {contact === undefined ? (
        <p className="mt-5 text-sm text-ink-muted">Looking up BizzFlow records…</p>
      ) : typeof contact === "string" ? (
        <p className="mt-5 text-sm text-danger">{contact}</p>
      ) : (
        <div className="mt-5 border-t border-line">
          <Section title="Orders" empty="No orders with this number.">
            {contact.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="block rounded-lg border border-line p-2.5 transition-colors hover:bg-wash">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{o.reference ?? "Order"}</span>
                    <Badge size="sm" tone={o.deleted ? "danger" : "neutral"}>{o.deleted ? "Deleted" : o.status}</Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">{o.name}</span>
                  {o.offer && <span className="block truncate text-xs text-ink-muted">{o.offer}</span>}
                  <span className="block text-[11px] text-ink-muted">{formatKualaLumpur(o.createdAt)}</span>
                </Link>
              </li>
            ))}
          </Section>
          <Section title="Cases" empty="No crawled cases with this number.">
            {contact.cases.map((c) => (
              <li key={c.caseNo} className="rounded-lg border border-line p-2.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm tabular-nums text-ink">{c.caseNo}</span>
                  <Badge size="sm">{c.status ?? "—"}</Badge>
                </span>
                {c.name && <span className="mt-0.5 block truncate text-xs text-ink-muted">{c.name}</span>}
                {c.provider && <span className="block truncate text-xs text-ink-muted">{c.provider}</span>}
              </li>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-medium text-ink-muted">{title}</h3>
      {children.length === 0 ? <p className="mt-1 text-sm text-ink-muted">{empty}</p> : <ul className="mt-2 space-y-2">{children}</ul>}
    </div>
  );
}
