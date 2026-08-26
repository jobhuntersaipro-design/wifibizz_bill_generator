import { notFound } from "next/navigation";
import { getOrderDetail } from "@/actions/order";
import { OrderDetailView } from "@/components/order-entry/order-detail/OrderDetailView";

// A standalone tab lives or dies by its tab title — a dozen tabs all reading
// the app name are indistinguishable. Deliberately NOT the customer name:
// browser tab titles leak into window lists and screen shares.
export const metadata = { title: "Order Details — BizzFlow" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const result = await getOrderDetail(orderId);
  if (!result.success || !result.data) notFound();

  return <OrderDetailView order={result.data} />;
}
