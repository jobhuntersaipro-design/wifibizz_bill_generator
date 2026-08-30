import { OrderOversight } from "@/components/admin/order-oversight";

export default function AdminOrdersPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Orders</h1>
        <p className="text-sm text-[#697386] mt-1">
          Every agent&apos;s orders, including deleted ones — usage, failures, and details
        </p>
      </div>
      <OrderOversight />
    </div>
  );
}
