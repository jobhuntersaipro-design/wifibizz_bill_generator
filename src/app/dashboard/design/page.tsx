import type { Metadata } from "next";
import { ArcGallery } from "@/components/design/ArcGallery";

export const metadata: Metadata = { title: "Design · BizzFlow" };

export default function DesignPage() {
  return <ArcGallery />;
}
