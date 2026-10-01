"use client";

import { useState } from "react";
import { CheckCircle2, FileText, Folder, Inbox } from "lucide-react";
import { Avatar } from "@/components/arc/components/avatar/avatar";
import { AvatarGroup } from "@/components/arc/components/avatar-group/avatar-group";
import { Badge } from "@/components/arc/components/badge/badge";
import { Button } from "@/components/arc/components/button/button";
import { Card } from "@/components/arc/components/card/card";
import { MetricCard } from "@/components/arc/components/metric-card/metric-card";
import { EmptyState } from "@/components/arc/components/empty-state/empty-state";
import { TreeView } from "@/components/arc/components/tree-view/tree-view";
import { Pagination } from "@/components/arc/components/pagination/pagination";
import { FilterToolbar, type FilterChip } from "@/components/arc/components/filter-toolbar/filter-toolbar";
import { SortableDataTable } from "@/components/arc/components/sortable-data-table/sortable-data-table";
import { Sparkline } from "@/components/arc/components/sparkline/sparkline";
import { Gauge } from "@/components/arc/components/gauge/gauge";
import { AnimatedCounter } from "@/components/arc/components/animated-counter/animated-counter";
import { CodeBlock } from "@/components/arc/components/code-block/code-block";
import { ImageCompare } from "@/components/arc/components/image-compare/image-compare";
import { Carousel } from "@/components/arc/components/carousel/carousel";
import { BarChart } from "@/components/arc/components/bar-chart/bar-chart";
import { ActivityHeatmap } from "@/components/arc/components/activity-heatmap/activity-heatmap";
import { Timeline } from "@/components/arc/components/timeline/timeline";
import { LineChart } from "@/components/arc/components/line-chart/line-chart";
import { DonutChart } from "@/components/arc/components/donut-chart/donut-chart";
import { Streamgraph } from "@/components/arc/components/streamgraph/streamgraph";
import { BrushChart } from "@/components/arc/components/brush-chart/brush-chart";
import { Ridgeline } from "@/components/arc/components/ridgeline/ridgeline";
import { Treemap } from "@/components/arc/components/treemap/treemap";
import { WaffleChart } from "@/components/arc/components/waffle-chart/waffle-chart";
import { SlopeChart } from "@/components/arc/components/slope-chart/slope-chart";
import { JsonViewer } from "@/components/arc/components/json-viewer/json-viewer";
import { ChatThread } from "@/components/arc/components/chat-thread/chat-thread";
import { CommentThread } from "@/components/arc/components/comment-thread/comment-thread";
import { person } from "@/components/arc/lib/media";
import type { ArcDemo } from "./gallery-context";
import styles from "./demos.module.css";

/** A small deterministic wave, so sample charts look alive but never change between renders. */
function wave(n: number, base: number, amp: number, seed = 1): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(base + amp * Math.sin(i * 0.7 + seed) + (amp / 3) * Math.cos(i * 1.9 + seed * 2)));
}

const WEEKS = ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"];
const HOME = wave(8, 60, 18, 1);
const BIZ = wave(8, 22, 8, 2);
const NOW = Date.UTC(2026, 9, 1, 9, 0);
const DAY = 86_400_000;

function AvatarDemo() {
  const p = person("emma-collins");
  return <div className={styles.row}><Avatar name={p.name} src={p.src} size="lg" status="online" /><Avatar name="Aiboot Agent" size="lg" /><Avatar name="Sofie" size="md" status="offline" /></div>;
}

function AvatarGroupDemo() {
  const ids = ["emma-collins", "marcus-johnson", "jasmine-brooks", "olivia-bennett", "daniel-kim", "chloe-nguyen"] as const;
  return <AvatarGroup members={ids.map((id) => ({ name: person(id).name, src: person(id).src }))} />;
}

function BadgeDemo() {
  return (
    <div className={styles.row}>
      <Badge tone="success">Submitted</Badge><Badge tone="info">Submitting</Badge>
      <Badge tone="warning">Needs voiding</Badge><Badge tone="danger">Failed</Badge><Badge>Draft</Badge>
    </div>
  );
}

function CardDemo() {
  return (
    <div className={styles.stack}>
      <Card title="ORD-0276 · Wojak Lang" description="Unifi Home 300Mbps · Premium Value" status="Submitted" meta="2 hours ago" details={<p className={styles.panel}>Order 2608000121750632, RM100 advance, appointment 21 Aug 17:00.</p>} />
    </div>
  );
}

function MetricCardDemo() {
  return <div className={styles.stack}><MetricCard label="Activated cases" value={1316} context="Last 30 days" change="+12%" /></div>;
}

function EmptyStateDemo() {
  return <EmptyState icon={<Inbox size={22} />} title="No orders yet" description="Create a draft and submit it to the dealer portal." action={<Button>New order</Button>} />;
}

function TreeViewDemo() {
  return (
    <TreeView
      nodes={[
        { id: "orders", label: "orders", icon: <Folder size={16} />, children: [
          { id: "ic", label: "940728065051_mykad_1.jpg", icon: <FileText size={16} /> },
          { id: "bill", label: "utility_bill.pdf", icon: <FileText size={16} /> },
        ] },
        { id: "bills", label: "bills", icon: <Folder size={16} />, children: [{ id: "ib", label: "internet_bill.pdf", icon: <FileText size={16} /> }] },
      ]}
    />
  );
}

function PaginationDemo() {
  const [page, setPage] = useState(3);
  return <Pagination page={page} pageCount={12} onPageChange={setPage} />;
}

function FilterToolbarDemo() {
  const [filters, setFilters] = useState<FilterChip[]>([{ id: "status", label: "Status", value: "Failed" }, { id: "pkg", label: "Package", value: "300Mbps" }]);
  return (
    <div className={styles.fill}>
      <FilterToolbar
        filters={filters}
        onRemove={(id) => setFilters((f) => f.filter((x) => x.id !== id))}
        onClearAll={() => setFilters([])}
        addFilter={{
          fields: [{ id: "agent", label: "Agent", options: ["Aiboot", "Brian Tan", "Sofie"] }, { id: "state", label: "State", options: ["Selangor", "Johor", "Sabah"] }],
          onAdd: (filter) => setFilters((f) => [...f.filter((x) => x.id !== filter.id), filter]),
        }}
      />
    </div>
  );
}

const ORDER_ROWS = [
  { ref: "ORD-0275", customer: "Lin Chin Chean", attempts: 3, status: "Failed" },
  { ref: "ORD-0276", customer: "Wojak Lang", attempts: 1, status: "Submitted" },
  { ref: "ORD-0277", customer: "Ho Ho Ho", attempts: 2, status: "Submitted" },
  { ref: "ORD-0278", customer: "Xu Qing", attempts: 0, status: "Draft" },
];

function SortableDataTableDemo() {
  return (
    <div className={styles.fill}>
      <SortableDataTable
        caption="Orders"
        rows={ORDER_ROWS}
        rowKey="ref"
        selectable
        columns={[
          { key: "ref", label: "Order", sortable: true },
          { key: "customer", label: "Customer", sortable: true },
          { key: "attempts", label: "Tries", sortable: true },
          { key: "status", label: "Status", render: (value) => <Badge tone={value === "Failed" ? "danger" : value === "Submitted" ? "success" : "neutral"}>{String(value)}</Badge> },
        ]}
      />
    </div>
  );
}

function SparklineDemo() {
  return <div className={styles.stack}><Sparkline data={wave(20, 40, 12, 3)} label="Submits per day" /></div>;
}

function GaugeDemo() {
  return <Gauge value={72} label="Submit success" detail="Last 7 days" thresholds={[{ from: 0, tone: "danger", label: "Low" }, { from: 50, tone: "warning", label: "Fair" }, { from: 70, tone: "success", label: "Good" }]} />;
}

function AnimatedCounterDemo() {
  const [value, setValue] = useState(1316);
  return <div className={styles.row}><span className={styles.title}><AnimatedCounter value={value} label="Cases" /></span><Button variant="secondary" onClick={() => setValue((v) => v + 137)}>Crawl</Button></div>;
}

function CodeBlockDemo() {
  return <div className={styles.fill}><CodeBlock language="bash" code={'curl -X POST https://bizzflow.top/api/crawl \\\n  -H "Content-Type: application/json" \\\n  -d \'{"email": "agent@example.com"}\''} /></div>;
}

function ImageCompareDemo() {
  return (
    <div className={styles.fill}>
      <ImageCompare
        labels={["Classic", "Arc"]}
        aspectRatio="16 / 7"
        before={<div className={`${styles.compare} ${styles.compareBefore}`}>Classic</div>}
        after={<div className={`${styles.compare} ${styles.compareAfter}`}>Arc</div>}
      />
    </div>
  );
}

function CarouselDemo() {
  return (
    <div className={styles.fill}>
      <Carousel label="Plans">
        {["Unifi Home 100Mbps", "Unifi Home 300Mbps", "Unifi Home 500Mbps", "Unifi Home 1Gbps"].map((plan) => <div key={plan} className={styles.slide}>{plan}</div>)}
      </Carousel>
    </div>
  );
}

function BarChartDemo() {
  return <div className={styles.fill}><BarChart label="Submitted orders" period="Last 8 weeks" data={WEEKS.map((w, i) => ({ key: w, label: w, value: HOME[i] }))} /></div>;
}

function ActivityHeatmapDemo() {
  const days = Array.from({ length: 140 }, (_, i) => ({ date: new Date(NOW - (139 - i) * DAY).toISOString().slice(0, 10), count: Math.max(0, Math.round(3 + 3 * Math.sin(i * 0.45) + ((i * 7) % 5) - 2)) }));
  return <div className={styles.fill}><ActivityHeatmap days={days} label="Crawls" period="Last 20 weeks" unit={{ one: "crawl", other: "crawls" }} /></div>;
}

function TimelineDemo() {
  return (
    <div className={styles.fill}>
      <Timeline
        label="ORD-0275 history"
        now={NOW}
        events={[
          { id: "1", at: NOW - 40 * 60_000, title: "Draft saved", actor: "Aiboot" },
          { id: "2", at: NOW - 30 * 60_000, title: "Submitted to the portal", meta: "Attempt 1" },
          { id: "3", at: NOW - 25 * 60_000, title: "Order 2608000125372808 minted", icon: <CheckCircle2 size={16} />, tone: "success" },
          { id: "4", at: NOW - 22 * 60_000, title: "Address already has TM services", tone: "danger", detail: "Terminal — no automatic retry." },
        ]}
      />
    </div>
  );
}

function LineChartDemo() {
  return (
    <div className={styles.fill}>
      <LineChart
        label="Activated cases"
        series={[{ key: "home", label: "Home Fibre", area: true }, { key: "biz", label: "Business Fibre" }]}
        data={WEEKS.map((w, i) => ({ key: w, label: w, values: { home: HOME[i], biz: BIZ[i] } }))}
      />
    </div>
  );
}

function DonutChartDemo() {
  return <div className={styles.fill}><DonutChart label="Orders by status" data={[{ key: "submitted", label: "Submitted", value: 128 }, { key: "failed", label: "Failed", value: 21 }, { key: "draft", label: "Draft", value: 34 }, { key: "cancelled", label: "Cancelled", value: 6 }]} /></div>;
}

function StreamgraphDemo() {
  const fourG = wave(8, 10, 4, 5);
  return (
    <div className={styles.fill}>
      <Streamgraph
        label="Cases by module"
        series={[{ key: "home", label: "Home" }, { key: "biz", label: "Business" }, { key: "fourG", label: "4G" }]}
        data={WEEKS.map((w, i) => ({ key: w, label: w, values: { home: HOME[i], biz: BIZ[i], fourG: fourG[i] } }))}
      />
    </div>
  );
}

function BrushChartDemo() {
  const values = wave(90, 50, 20, 4);
  return <div className={styles.fill}><BrushChart label="Daily crawled cases" data={values.map((value, i) => ({ date: NOW - (89 - i) * DAY, value }))} /></div>;
}

function RidgelineDemo() {
  return (
    <div className={styles.fill}>
      <Ridgeline
        label="Submit duration by plan"
        series={["100Mbps", "300Mbps", "500Mbps", "1Gbps"].map((id, i) => ({ id, label: id, values: wave(24, 90 + i * 15, 25, i + 1) }))}
      />
    </div>
  );
}

function TreemapDemo() {
  return (
    <div className={styles.fill}>
      <Treemap
        label="Cases by state"
        data={{
          id: "all", label: "Malaysia", children: [
            { id: "sel", label: "Selangor", value: 412 }, { id: "kl", label: "Kuala Lumpur", value: 238 }, { id: "jhr", label: "Johor", value: 197 },
            { id: "png", label: "Pulau Pinang", value: 121 }, { id: "sbh", label: "Sabah", value: 88 }, { id: "prk", label: "Perak", value: 64 },
          ],
        }}
      />
    </div>
  );
}

function WaffleChartDemo() {
  return <WaffleChart label="Case credits" data={[{ key: "used", label: "Used", value: 648 }, { key: "left", label: "Remaining", value: 352 }]} />;
}

function SlopeChartDemo() {
  return (
    <div className={styles.fill}>
      <SlopeChart
        label="Success rate by agent"
        startLabel="August"
        endLabel="September"
        data={[{ key: "a", label: "Aiboot", start: 61, end: 84 }, { key: "b", label: "Brian Tan", start: 72, end: 77 }, { key: "c", label: "Calvin", start: 80, end: 69 }]}
      />
    </div>
  );
}

function JsonViewerDemo() {
  return (
    <div className={styles.fill}>
      <JsonViewer data={{ status: "error", stage: "customer_order_info", error: "next_blocked", portal_code: "40300805", attempt: 2, documents: ["mykad", "utility_bill"], do_pay: false }} />
    </div>
  );
}

function ChatThreadDemo() {
  const agent = person("sofia-ramirez");
  return (
    <div className={styles.fill}>
      <ChatThread
        currentUserId="me"
        participants={[{ id: "me", name: "You" }, { id: "sofie", name: agent.name, avatar: agent.src }]}
        defaultMessages={[
          { id: "1", authorId: "sofie", text: "ORD-0275 failed — address already has TM services.", createdAt: NOW - 6 * 60_000 },
          { id: "2", authorId: "me", text: "Thanks, I'll ask the customer for a different unit.", createdAt: NOW - 4 * 60_000, status: "read" },
        ]}
      />
    </div>
  );
}

function CommentThreadDemo() {
  const me = { id: "me", name: "Aiboot Agent" };
  const lead = { id: "lead", name: person("nathan-cole").name, avatar: person("nathan-cole").src };
  return (
    <div className={styles.fill}>
      <CommentThread
        currentUser={me}
        people={[me, lead]}
        title="Plan settings: Unifi Home 300Mbps"
        defaultComments={[{ id: "c1", author: lead, body: "Publish this once the Netflix group is tagged as a channel.", createdAt: new Date(NOW - 3 * 3_600_000).toISOString() }]}
      />
    </div>
  );
}

export const DATA_DEMOS: Record<string, ArcDemo> = {
  avatar: AvatarDemo,
  "avatar-group": AvatarGroupDemo,
  badge: BadgeDemo,
  card: CardDemo,
  "metric-card": MetricCardDemo,
  "empty-state": EmptyStateDemo,
  "tree-view": TreeViewDemo,
  pagination: PaginationDemo,
  "filter-toolbar": FilterToolbarDemo,
  "sortable-data-table": SortableDataTableDemo,
  sparkline: SparklineDemo,
  gauge: GaugeDemo,
  "animated-counter": AnimatedCounterDemo,
  "code-block": CodeBlockDemo,
  "image-compare": ImageCompareDemo,
  carousel: CarouselDemo,
  "bar-chart": BarChartDemo,
  "activity-heatmap": ActivityHeatmapDemo,
  timeline: TimelineDemo,
  "line-chart": LineChartDemo,
  "donut-chart": DonutChartDemo,
  streamgraph: StreamgraphDemo,
  "brush-chart": BrushChartDemo,
  ridgeline: RidgelineDemo,
  treemap: TreemapDemo,
  "waffle-chart": WaffleChartDemo,
  "slope-chart": SlopeChartDemo,
  "json-viewer": JsonViewerDemo,
  "chat-thread": ChatThreadDemo,
  "comment-thread": CommentThreadDemo,
};
