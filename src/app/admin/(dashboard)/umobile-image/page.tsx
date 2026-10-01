import { adminListUmobileImages } from "@/actions/umobile-images";
import { UmobileImages } from "@/components/admin/umobile-images";

export default async function AdminUmobileImagePage() {
  const res = await adminListUmobileImages();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Umobile Image</h1>
        <p className="text-sm text-ink-muted mt-1">
          Modem photos for Umobile bills. Generation picks one at random.
        </p>
      </div>
      <UmobileImages initialImages={res.success ? res.images : []} />
    </div>
  );
}
