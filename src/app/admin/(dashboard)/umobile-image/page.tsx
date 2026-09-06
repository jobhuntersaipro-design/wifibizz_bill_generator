import { adminListUmobileImages } from "@/actions/umobile-images";
import { UmobileImages } from "@/components/admin/umobile-images";

export default async function AdminUmobileImagePage() {
  const res = await adminListUmobileImages();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0A2540]">umobile image</h1>
        <p className="text-sm text-[#697386] mt-1">
          Modem photos for UMobile internet bills. Generation picks one at random.
        </p>
      </div>
      <UmobileImages initialImages={res.success ? res.images : []} />
    </div>
  );
}
