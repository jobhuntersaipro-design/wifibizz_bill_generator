import { redirect } from "next/navigation";
import { WhatsappDesk } from "@/components/admin/whatsapp-desk";
import { verifyAdminSession } from "@/lib/admin-auth";
import { listChats, listLabels } from "@/lib/whatsapp-events";
import { whatsappFixtureEnabled } from "@/lib/whatsapp-inbox-fixture";
import { backfillFromEvents } from "@/lib/whatsapp-store";

export const dynamic = "force-dynamic";

export default async function WhatsappAdminPage() {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  if (!whatsappFixtureEnabled()) await backfillFromEvents();
  const [chats, labels] = await Promise.all([listChats(), listLabels()]);
  return <WhatsappDesk initialChats={chats} initialLabels={labels} />;
}
