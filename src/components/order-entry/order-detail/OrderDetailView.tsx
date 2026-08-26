"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, History, ListChecks } from "lucide-react";
import { initialsFor, type OrderListItem } from "@/lib/order-types";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SubmitProgress } from "../SubmitProgress";
import { useOrderAttempts, useTicker } from "./hooks";
import { AttemptList } from "./OrderAttemptHistory";
import { OrderDetailHero } from "./OrderDetailHero";
import { OrderDetails } from "./OrderDetailsTab";
import { SectionCard } from "./shared";

/**
 * Full-page order detail — the content that used to live in the
 * `OrderHistoryPanel` slide-in Sheet, given page width and a real URL
 * instead of a 30rem panel and client-only state. Opened in a new tab from
 * the Orders list, so back-navigation can't rely on this tab having history.
 */
export function OrderDetailView({ order }: { order: OrderListItem }) {
  const router = useRouter();
  const live = order.status === "submitting";
  const { attempts, error } = useOrderAttempts(order.id, live);
  const now = useTicker(live);

  function back() {
    // Opened in a new tab, so this tab usually has no history to go back to —
    // fall back to a plain link to the list rather than a no-op back().
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/dashboard/order-entry/drafts");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      {/* ── Header: identity as a block, not a line ─────────────────────── */}
      <div>
        <button
          type="button"
          onClick={back}
          className="group -ml-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-[#697386] transition-colors duration-150 hover:bg-[#F6F9FC] hover:text-[#0A2540] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden="true" />
          Orders
        </button>
        <header className="mt-2 flex items-start gap-3">
          <span
            className="panel-item-in flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EDEBFF] text-[13px] font-semibold text-[#635BFF]"
            aria-hidden="true"
          >
            {initialsFor(order.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <h1
              className="panel-item-in truncate text-[18px] font-semibold leading-tight text-[#0A2540]"
              style={{ animationDelay: "40ms" }}
            >
              {order.fullName}
            </h1>
            <div
              className="panel-item-in mt-1 flex flex-wrap items-center gap-1.5"
              style={{ animationDelay: "80ms" }}
            >
              <Badge className="rounded-md border-0 bg-[#EDEBFF] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#635BFF] transition-colors duration-150 hover:bg-[#DEDAFF]">
                {order.reference ?? "No reference"}
              </Badge>
              <Badge className="rounded-md border-0 bg-[#F6F9FC] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#425466] transition-colors duration-150 hover:bg-[#E3E8EF]">
                {order.idType} · {order.idNumber}
              </Badge>
            </div>
          </div>
        </header>
      </div>

      <OrderDetailHero order={order} attempts={attempts} live={live} now={now} />

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <Tabs defaultValue={live ? "progress" : "history"} className="mt-1 gap-3">
        <TabsList variant="line" className="w-full justify-start gap-3 border-b border-[#E3E8EF] p-0">
          <TabsTrigger
            value="progress"
            className="min-h-10 flex-none cursor-pointer px-1 pb-2 text-[12px] text-[#697386] after:bottom-[-1px] after:bg-[#635BFF] data-active:text-[#0A2540]"
          >
            Progress
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="min-h-10 flex-none cursor-pointer px-1 pb-2 text-[12px] text-[#697386] after:bottom-[-1px] after:bg-[#635BFF] data-active:text-[#0A2540]"
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            History{attempts?.length ? ` · ${attempts.length}` : ""}
          </TabsTrigger>
          <TabsTrigger
            value="details"
            className="min-h-10 flex-none cursor-pointer px-1 pb-2 text-[12px] text-[#697386] after:bottom-[-1px] after:bg-[#635BFF] data-active:text-[#0A2540]"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Details
          </TabsTrigger>
        </TabsList>

        <TabsContent value="progress" className="tab-panel-in flex flex-col gap-3">
          <SectionCard icon={ListChecks} label={live ? "Current run" : "Last run"}>
            <div className="-mx-4 -mb-3">
              <SubmitProgress
                stage={order.stage}
                status={order.status}
                errorMessage={order.errorMessage}
                errorCode={order.errorCode}
                orderId={order.orderId}
                // This page reads the event history rather than the progress
                // poll, so the run's own stages are the floor here.
                observedStages={attempts?.[0]?.events.map((e) => e.stage)}
              />
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="history" className="tab-panel-in flex flex-col gap-2">
          <AttemptList
            attempts={attempts}
            error={error}
            hasAttempted={order.attempt > 0 || !!order.orderId}
          />
        </TabsContent>

        <TabsContent value="details" className="tab-panel-in flex flex-col gap-3">
          <OrderDetails order={order} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
