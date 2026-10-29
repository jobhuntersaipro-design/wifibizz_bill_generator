import { redirect } from "next/navigation";
import { WhatsappDesk } from "@/components/admin/whatsapp-desk";
import { verifyAdminSession } from "@/lib/admin-auth";
import { getHistorySync, listChats, listLabels } from "@/lib/whatsapp-events";
import { whatsappFixtureEnabled } from "@/lib/whatsapp-inbox-fixture";
import { backfillFromEvents } from "@/lib/whatsapp-store";
import { dualhookConfig } from "@/lib/dualhook";

export const dynamic = "force-dynamic";

export default async function WhatsappAdminPage() {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  if (!whatsappFixtureEnabled()) await backfillFromEvents();
  const [chats, labels, history] = await Promise.all([listChats(), listLabels(), getHistorySync()]);
  return <WhatsappDesk initialChats={chats} initialLabels={labels} initialHistory={history} transport={dualhookConfig() ? "dualhook" : "gateway"} />;
}
