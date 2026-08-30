import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetOrderDetail } from "@/actions/admin-orders";
import { groupByAttempt, type StatusEventView } from "@/lib/order-history";
import { AdminOrderDetail } from "@/components/admin/order-detail";

/**
 * One order, seen by admin — including a deleted one.
 *
 * Server component: it reads under the admin JWT and passes plain data down, so
 * nothing in `/admin` needs a NextAuth session.
 *
 * It does NOT reuse the agent-side detail components. They are typed around
 * `OrderListItem` (private to a "use server" module) and built around document
 * previews and capture carousels that admin cannot serve — passing a half-filled
 * shape into a UI designed to show things that will not load would look broken
 * rather than deliberate. The reuse is `groupByAttempt`, which is the part that
 * actually holds logic.
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await adminGetOrderDetail(id);
  if (!res.success || !res.data) notFound();

  const { order, events } = res.data;
  const views: StatusEventView[] = events.map((e) => ({
    id: e.id,
    attempt: e.attempt,
    stage: e.stage,
    status: e.status,
    message: e.message,
    errorCode: e.errorCode,
    createdAt: e.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-5">
      <Link href="/admin/orders" className="text-sm text-[#635BFF] hover:underline">
        ← All orders
      </Link>
      <AdminOrderDetail
        order={{
          id: order.id,
          reference: order.reference,
          fullName: order.fullName,
          idType: order.idType,
          idNumber: order.idNumber,
          email: order.email,
          mobilePrefix: order.mobilePrefix,
          mobile: order.mobile,
          addressFull: order.addressFull,
          street: order.street,
          postcode: order.postcode,
          city: order.city,
          state: order.state,
          offerName: order.offerName,
          deviceName: order.deviceName,
          deviceCode: order.deviceCode,
          remarks: order.remarks,
          status: order.status,
          orderId: order.orderId,
          errorCode: order.errorCode,
          errorMessage: order.errorMessage,
          attempt: order.attempt,
          autoRetries: order.autoRetries,
          appointmentLeadHours: order.appointmentLeadHours,
          createdAt: order.createdAt.toISOString(),
          deletedAt: order.deletedAt ? order.deletedAt.toISOString() : null,
          agentEmail: order.user.email,
          documentCount: Array.isArray(order.documents) ? order.documents.length : 0,
        }}
        attempts={groupByAttempt(views)}
      />
    </div>
  );
}
