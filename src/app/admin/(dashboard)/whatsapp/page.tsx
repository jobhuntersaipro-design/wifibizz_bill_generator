import { redirect } from "next/navigation";
import { WhatsappDesk } from "@/components/admin/whatsapp-desk";
import { verifyAdminSession } from "@/lib/admin-auth";
import { listConversations, listWhatsappEvents } from "@/lib/whatsapp-events";

export const dynamic = "force-dynamic";

export default async function WhatsappAdminPage() {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  const [events, conversations] = await Promise.all([listWhatsappEvents(), listConversations()]);
  return <WhatsappDesk initial={events} initialConversations={conversations} />;
}
