import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetOrderDetail } from "@/actions/admin-orders";
import { adminLiveViewToken } from "@/actions/admin-submit";
import { LiveRunViewer } from "@/components/admin/live-run-viewer";

/**
 * Watch one run's browser. The stream comes from the droplet directly (Vercel
 * cannot hold a connection for the 10-15 minutes a submit takes), so this page
 * only mints the viewer token and hands the browser the droplet's public URL.
 */
export default async function AdminLiveRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { id } = await params;
  const { job } = await searchParams;
  const res = await adminGetOrderDetail(id);
  if (!res.success || !res.data) notFound();
  const order = res.data.order;
  const label = `${order.reference ?? order.fullName} · ${order.fullName}`;

  const scraperUrl = process.env.NEXT_PUBLIC_SCRAPER_API_URL ?? process.env.SCRAPER_API_URL ?? "http://localhost:5000";
  const jobId = job || order.jobId;
  const minted = jobId ? await adminLiveViewToken(id) : null;

  return (
    <div className="space-y-4">
      <Link href={`/admin/orders/${id}`} className="text-sm text-[#635BFF] hover:underline">← Back to the order</Link>
      {!jobId || !minted?.success ? (
        <p className="rounded-xl border border-[#E3E8EF] bg-white p-5 text-sm text-[#425466]">
          {order.status === "submitting" ? "This order's run has no job id yet — reload in a moment." : "This order has no run in flight."}
        </p>
      ) : (
        <LiveRunViewer orderId={id} label={label} jobId={minted.jobId} token={minted.viewerToken}
          expiresAt={minted.expiresAt} scraperUrl={scraperUrl} />
      )}
    </div>
  );
}
