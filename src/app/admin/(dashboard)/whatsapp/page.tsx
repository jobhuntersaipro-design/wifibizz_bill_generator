import { redirect } from "next/navigation";
import { WhatsappEvents } from "@/components/admin/whatsapp-events";
import { verifyAdminSession } from "@/lib/admin-auth";
import { listWhatsappEvents } from "@/lib/whatsapp-events";

export const dynamic = "force-dynamic";

export default async function WhatsappAdminPage() {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  const events = await listWhatsappEvents();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">WhatsApp</h1>
        <p className="text-sm text-ink-muted mt-1">
          Coexistence webhook events, newest first. Read only.
        </p>
      </div>
      <WhatsappEvents initial={events} />
    </div>
  );
}
