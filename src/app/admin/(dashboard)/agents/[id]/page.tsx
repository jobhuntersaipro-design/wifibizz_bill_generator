import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetAgent } from "@/actions/admin-orders";
import { AgentDetail } from "@/components/admin/agent-detail";

/**
 * Everything about one agent in one place.
 *
 * Composes the pieces built in phases 1-3 rather than adding queries: the
 * connection badge, the live panel filtered to this agent, the trend and error
 * charts with the agent pinned, and the oversight table filtered the same way.
 */
export default async function AdminAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await adminGetAgent(id);
  if (!res.success || !res.data) notFound();
  const a = res.data;

  return (
    <div className="space-y-5">
      <Link href="/admin" className="text-sm text-[#635BFF] hover:underline">← All users</Link>
      <AgentDetail
        agent={{
          id: a.id,
          name: a.name,
          email: a.email,
          notes: a.notes,
          caseLimit: a.caseLimit,
          orderEntryEnabled: a.orderEntryEnabled,
          isSuperAdmin: a.isSuperAdmin,
          createdAt: a.createdAt.toISOString(),
          staffCode: a.dealerAccount?.staffCode ?? null,
          registeredEmail: a.dealerAccount?.registeredEmail ?? null,
          lastConnectedAt: a.dealerAccount?.lastConnectedAt?.toISOString() ?? null,
          connection: a.connection,
        }}
      />
    </div>
  );
}
