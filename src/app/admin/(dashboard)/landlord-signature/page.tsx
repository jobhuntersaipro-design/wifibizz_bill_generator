import { adminListLandlordSignatures } from "@/actions/landlord-signatures";
import { LandlordSignatures } from "@/components/admin/landlord-signatures";

export default async function AdminLandlordSignaturePage() {
  const res = await adminListLandlordSignatures();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0A2540]">landlord signature</h1>
        <p className="text-sm text-[#697386] mt-1">
          Signature images for the Tenancy Agreement and Auth Letter. Generation
          picks one at random and pairs it to the invented landlord. An empty
          pool still generates — the signature line stays blank.
        </p>
      </div>
      <LandlordSignatures initialImages={res.success ? res.images : []} />
    </div>
  );
}
