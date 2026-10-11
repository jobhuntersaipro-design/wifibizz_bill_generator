import { redirect } from "next/navigation";
import { WhatsappDesk } from "@/components/admin/whatsapp-desk";
import { verifyAdminSession } from "@/lib/admin-auth";
import { listWhatsappEvents } from "@/lib/whatsapp-events";

export const dynamic = "force-dynamic";

export default async function WhatsappAdminPage() {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  const events = await listWhatsappEvents();
  return <WhatsappDesk initial={events} />;
}
