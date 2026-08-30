import type { AttemptView } from "@/lib/order-history";
import { isFailureStatus } from "@/lib/admin-order-stats";

export interface AdminOrderView {
  id: string;
  reference: string | null;
  fullName: string;
  idType: string;
  idNumber: string;
  email: string | null;
  mobilePrefix: string | null;
  mobile: string | null;
  addressFull: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  offerName: string | null;
  deviceName: string | null;
  deviceCode: string | null;
  remarks: string | null;
  status: string;
  orderId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  autoRetries: number;
  appointmentLeadHours: number | null;
  createdAt: string;
  deletedAt: string | null;
  agentEmail: string | null;
  documentCount: number;
}

/**
 * Read-only view of one order for admin oversight.
 *
 * A missing value renders as a dash rather than hiding its row: an absent row
 * reads as "not applicable", which is a different claim from "nobody filled
 * this in" and the second is usually the interesting one here.
 */
export function AdminOrderDetail({
  order,
  attempts,
}: {
  order: AdminOrderView;
  attempts: AttemptView[];
}) {
  const phone = order.mobile ? `+${order.mobilePrefix ?? "60"} ${order.mobile}` : null;
  const address =
    order.addressFull ||
    [order.street, order.postcode, order.city, order.state].filter(Boolean).join(", ") ||
    null;

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-[#E3E8EF] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[#0A2540]">
              {order.reference ?? order.fullName}
            </h1>
            <p className="mt-0.5 text-sm text-[#697386]">
              {order.fullName} · {order.agentEmail ?? "unknown agent"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full bg-[#F1F3F6] px-2.5 py-1 text-xs text-[#425466]">
              {order.status}
            </span>
            {order.deletedAt && (
              <span className="rounded-full bg-[#FEF3F2] px-2.5 py-1 text-xs text-[#B42318]">
                Deleted {order.deletedAt.slice(0, 10)}
              </span>
            )}
          </div>
        </div>
        {order.orderId && (
          <p className="mt-3 text-sm text-[#0A2540]">
            Portal order <span className="font-mono tabular-nums">{order.orderId}</span>
          </p>
        )}
        {/* The same text means two different things depending on the status.
            On a failure it is the portal's refusal; on a SUCCESS it is the note
            applyResult writes there — the advance payment, typically. Painting
            the second one red made a completed order look broken. */}
        {order.errorMessage && (
          isFailureStatus(order.status) ? (
            <p className="mt-3 rounded-md bg-[#FEF3F2] px-3 py-2 text-sm text-[#B42318]">
              {order.errorCode ? `${order.errorCode}: ` : ""}
              {order.errorMessage}
            </p>
          ) : (
            <p className="mt-3 rounded-md bg-[#F6F9FC] px-3 py-2 text-sm text-[#425466]">
              {order.errorMessage}
            </p>
          )
        )}
      </header>

      <Section title="Order">
        <Field label="ID" value={`${order.idType} ${order.idNumber}`} />
        <Field label="Phone" value={phone} />
        <Field label="Email" value={order.email} />
        <Field label="Installation address" value={address} />
        <Field label="Package" value={order.offerName} />
        <Field
          label="Device"
          value={order.deviceName ? `${order.deviceName}${order.deviceCode ? ` #${order.deviceCode}` : ""}` : null}
        />
        <Field
          label="Appointment lead"
          value={order.appointmentLeadHours === null ? "Default" : `${order.appointmentLeadHours} hours`}
        />
        <Field label="Remarks" value={order.remarks} />
        <Field label="Created" value={order.createdAt.slice(0, 16).replace("T", " ")} />
        <Field label="Attempts" value={`${order.attempt} (${order.autoRetries} automatic)`} />
        <Field
          label="Documents"
          // Stated rather than shown. /api/orders/document resolves R2 keys
          // against the CALLER's namespace and admin has none, so a thumbnail
          // here would reliably fail to load. Saying so beats a broken image.
          value={
            order.documentCount === 0
              ? "None attached"
              : `${order.documentCount} attached — viewable from the agent's own account only`
          }
        />
      </Section>

      <Section title={`History · ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`}>
        {attempts.length === 0 ? (
          <p className="col-span-2 text-sm text-[#697386]">
            This order has never been submitted.
          </p>
        ) : (
          <ol className="col-span-2 space-y-4">
            {attempts.map((a) => (
              <li key={a.attempt} className="rounded-lg border border-[#E3E8EF] p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-[#0A2540]">
                    Attempt {a.attempt}
                  </span>
                  <span className="text-xs text-[#697386]">
                    {a.outcome} · {a.startedAt.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {a.events.map((e) => (
                    <li key={e.id} className="flex gap-3 text-xs">
                      <span className="w-32 shrink-0 tabular-nums text-[#697386]">
                        {e.createdAt.slice(11, 19)}
                      </span>
                      <span className="w-40 shrink-0 text-[#425466]">{e.stage ?? e.status}</span>
                      <span className="text-[#0A2540]">
                        {e.errorCode && (
                          <span className="mr-1 rounded bg-[#FEF3F2] px-1 py-0.5 text-[#B42318]">
                            {e.errorCode}
                          </span>
                        )}
                        {e.message ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#E3E8EF] bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-[#0A2540]">{title}</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-[#697386]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-[#0A2540]">{value || "—"}</dd>
    </div>
  );
}
