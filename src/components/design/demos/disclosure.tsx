"use client";

import { Button } from "@/components/arc/components/button/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/arc/components/drawer/drawer";
import { Accordion } from "@/components/arc/components/accordion/accordion";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/arc/components/dialog/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/arc/components/popover/popover";
import { Tooltip } from "@/components/arc/components/tooltip/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/arc/components/tabs/tabs";
import { ExpandableCard } from "@/components/arc/components/expandable-card/expandable-card";
import { Breadcrumb } from "@/components/arc/components/breadcrumb/breadcrumb";
import { BottomSheet, BottomSheetClose } from "@/components/arc/components/bottom-sheet/bottom-sheet";
import { HoverCard, HoverCardProfile } from "@/components/arc/components/hover-card/hover-card";
import { ResizablePanel, ResizablePanels } from "@/components/arc/components/resizable-panels/resizable-panels";
import { ScrollArea } from "@/components/arc/components/scroll-area/scroll-area";
import { person } from "@/components/arc/lib/media";
import type { ArcDemo } from "./gallery-context";
import styles from "./demos.module.css";

function DrawerDemo() {
  return (
    <Drawer>
      <DrawerTrigger asChild><Button variant="secondary">Open order details</Button></DrawerTrigger>
      <DrawerContent title="ORD-0275" description="Lin Chin Chean · Unifi Home 300Mbps">
        <p className={styles.panel}>Attempt 3 of 3 failed: the address already has TM services installed.</p>
        <DrawerClose asChild><Button variant="secondary">Close</Button></DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}

function AccordionDemo() {
  return (
    <div className={styles.fill}>
      <Accordion
        items={[
          { title: "Why did my submit stop at Pay?", content: "Stop before Pay was ticked, so the run filled every page and left the order for you." },
          { title: "Is an automatic retry safe?", content: "Only transient failures retry, and every portal order number is kept in the history." },
          { title: "Where is the e-RF?", content: "On the order's Details tab once the portal confirms payment." },
        ]}
      />
    </div>
  );
}

function DialogDemo() {
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="danger">Cancel order…</Button></DialogTrigger>
      <DialogContent title="Cancel ORD-0276?" description="This does not void the order at Unifi — do that in the portal.">
        <div className={styles.row}>
          <DialogClose asChild><Button variant="secondary">Keep order</Button></DialogClose>
          <DialogClose asChild><Button variant="danger">Cancel order</Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PopoverDemo() {
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="secondary">Session</Button></PopoverTrigger>
      <PopoverContent>
        <p className={styles.panel}>Dealer session TMRS00517 expires in 6h 12m.</p>
      </PopoverContent>
    </Popover>
  );
}

function TooltipDemo() {
  return (
    <Tooltip content="A task is already running on the server">
      <Button variant="secondary">Hover me</Button>
    </Tooltip>
  );
}

function TabsDemo() {
  return (
    <div className={styles.fill}>
      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="captures">Captures</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="history"><p className={styles.panel}>Attempt 2 · Submitted · RM100 advance.</p></TabsContent>
        <TabsContent value="captures"><p className={styles.panel}>17 frames from the last run.</p></TabsContent>
        <TabsContent value="details"><p className={styles.panel}>Customer, package and documents.</p></TabsContent>
      </Tabs>
    </div>
  );
}

function ExpandableCardDemo() {
  return (
    <ExpandableCard title="Unifi Home 300Mbps" description="Premium Value with Device (36M)">
      <p className={styles.panel}>Includes a Samsung TV 43&quot; and a promo discount for 24 months.</p>
    </ExpandableCard>
  );
}

function BreadcrumbDemo() {
  return <Breadcrumb items={[{ label: "Order Entry", href: "#" }, { label: "Orders", href: "#" }, { label: "ORD-0275" }]} />;
}

function BottomSheetDemo() {
  return (
    <BottomSheet trigger={<Button variant="secondary">Open sheet</Button>} title="Filters" description="Drag to resize">
      <p className={styles.panel}>Status, package and date filters live here on a phone.</p>
      <BottomSheetClose asChild><Button>Apply</Button></BottomSheetClose>
    </BottomSheet>
  );
}

function HoverCardDemo() {
  const agent = person("sofia-ramirez");
  return (
    <HoverCard content={<HoverCardProfile name={agent.name} role="Order Entry agent" avatar={agent.src} stats={[{ label: "Submitted", value: 128 }, { label: "Failed", value: 6 }]} />}>
      <a href="#" className={styles.title}>@{agent.name}</a>
    </HoverCard>
  );
}

function ResizablePanelsDemo() {
  return (
    <div className={styles.resizable}>
      <ResizablePanels label="Order workspace">
        <ResizablePanel id="list" label="Orders" defaultSize={40} minSize={20}><p className={styles.panel}>Orders</p></ResizablePanel>
        <ResizablePanel id="detail" label="Detail" defaultSize={60} minSize={30}><p className={styles.panel}>Detail</p></ResizablePanel>
      </ResizablePanels>
    </div>
  );
}

function ScrollAreaDemo() {
  return (
    <div className={styles.fill}>
      <ScrollArea maxHeight={180} label="Recent cases">
        {Array.from({ length: 24 }, (_, i) => <div key={i} className={styles.scrollItem}>Case 2026{(73000 + i * 17).toString()}</div>)}
      </ScrollArea>
    </div>
  );
}

export const DISCLOSURE_DEMOS: Record<string, ArcDemo> = {
  drawer: DrawerDemo,
  accordion: AccordionDemo,
  dialog: DialogDemo,
  popover: PopoverDemo,
  tooltip: TooltipDemo,
  tabs: TabsDemo,
  "expandable-card": ExpandableCardDemo,
  breadcrumb: BreadcrumbDemo,
  "bottom-sheet": BottomSheetDemo,
  "hover-card": HoverCardDemo,
  "resizable-panels": ResizablePanelsDemo,
  "scroll-area": ScrollAreaDemo,
};
