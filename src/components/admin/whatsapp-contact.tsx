import Link from "next/link";
import type { WhatsappContact } from "@/actions/whatsapp";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";

/** BizzFlow orders and cases that carry this WhatsApp number. Read-only. */
export function WhatsappContactPanel({
  waId,
  name,
  contact,
  crm,
}: {
  waId: string | null;
  name?: string | null;
  contact: WhatsappContact | string | undefined;
  /** Stage / folder / tag controls for the open chat. */
  crm?: React.ReactNode;
}) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-line p-4 xl:flex">
      <h2 className="text-sm font-semibold text-ink">Contact</h2>
      {!waId ? (
        <p className="mt-2 text-sm text-ink-muted">Select a chat</p>
      ) : (
        <>
          {name && <p className="mt-1 text-sm font-medium text-ink">{name}</p>}
          <p className="mt-1 font-mono text-sm text-ink">+{waId}</p>
          {crm && <div className="mt-4">{crm}</div>}
          {contact === undefined ? (
            <p className="mt-4 text-sm text-ink-muted">Looking up BizzFlow records…</p>
          ) : typeof contact === "string" ? (
            <p className="mt-4 text-sm text-danger">{contact}</p>
          ) : (
            <>
              <Section title="Orders" empty="No orders with this number.">
                {contact.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/orders/${o.id}`} className="block rounded-lg border border-line p-2 hover:bg-wash">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{o.reference ?? "Order"}</span>
                        <span className="text-[11px] text-ink-muted">{o.deleted ? "Deleted" : o.status}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-muted">{o.name}</span>
                      {o.offer && <span className="block truncate text-xs text-ink-muted">{o.offer}</span>}
                      <span className="block text-[11px] text-ink-muted">{formatKualaLumpur(o.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </Section>
              <Section title="Cases" empty="No crawled cases with this number.">
                {contact.cases.map((c) => (
                  <li key={c.caseNo} className="rounded-lg border border-line p-2">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm text-ink">{c.caseNo}</span>
                      <span className="text-[11px] text-ink-muted">{c.status ?? "—"}</span>
                    </span>
                    {c.name && <span className="block truncate text-xs text-ink-muted">{c.name}</span>}
                    {c.provider && <span className="block truncate text-xs text-ink-muted">{c.provider}</span>}
                  </li>
                ))}
              </Section>
            </>
          )}
        </>
      )}
    </aside>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children.length === 0 ? <p className="mt-1 text-sm text-ink-muted">{empty}</p> : <ul className="mt-2 space-y-2">{children}</ul>}
    </div>
  );
}
