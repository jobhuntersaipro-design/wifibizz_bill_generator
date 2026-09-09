import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildInternetBillPdf } from "@/lib/bill-generator/umobile-modem";
import { generateUtilityBill } from "@/lib/bill-generator/utility-bill";
import { generateAuthorizationLetter } from "@/lib/bill-generator/authorization-letter";
import { generateTimeInvoice } from "@/lib/bill-generator/time-invoice";
import { generateTenancyAgreement } from "@/lib/bill-generator/tenancy-agreement";
import { createTaAuthContext } from "@/lib/bill-generator/landlord-signature";
import { parsePartiesSeed } from "@/lib/bill-generator/document-parties";
import {
  documentSeed,
  generatedFilename,
  isServerDocType,
  missingFieldsFor,
} from "@/lib/order-documents";

/**
 * POST /api/orders/generate-document
 *
 * Renders one document from an ORDER DRAFT's data and streams it back.
 *
 * It takes the live form values rather than an order id on purpose: an agent
 * generates while filling the form in, before the draft has ever been saved, and
 * requiring a save first would put a round trip between them and the document.
 *
 * Two deliberate differences from the five /api/bills/* routes:
 *
 *  - It does NOT look up `wifibizzUser`. An Order Entry agent need not have a
 *    WifiBizz account linked, and requiring one would make this unavailable to
 *    exactly the users it is for.
 *  - Nothing is stored and nothing is charged: no R2 object, no column, no
 *    `CaseUsageLog` row. There is no case to count it against — which is also
 *    what the authorization letter and TIME invoice already do for real cases.
 *
 * The document's content is whatever the caller sends. That is already true in
 * substance of the Case List path (the agent types the data upstream), but here
 * it is explicit in the request body rather than read from a crawled row.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const type = String(body?.type ?? "");
    if (!isServerDocType(type)) {
      return NextResponse.json(
        { success: false, error: `Unknown document type: ${type || "(none)"}` },
        { status: 400 },
      );
    }

    const source = {
      fullName: String(body?.fullName ?? "").trim(),
      idNumber: String(body?.idNumber ?? "").trim(),
      fullAddress: String(body?.fullAddress ?? "").trim(),
      mobile: String(body?.mobile ?? "").trim(),
      offerName: String(body?.offerName ?? "").trim(),
    };

    // The same rule the form's buttons use, re-run here because the route is
    // directly POST-able. A document with a blank name or address is not worth
    // handing to anyone, so this fails loudly rather than printing empty blocks.
    const missing = missingFieldsFor(type, source);
    if (missing.length > 0) {
      return NextResponse.json(
        { success: false, error: `Fill in ${missing.join(", ")} first.` },
        { status: 400 },
      );
    }

    const seed = documentSeed(source.idNumber);
    const caseData = {
      case_no: seed,
      full_name: source.fullName,
      full_address: source.fullAddress,
      mobile: source.mobile,
      id_no: source.idNumber,
    };

    let pdf: Buffer | Uint8Array;
    switch (type) {
      case "internet_bill": {
        pdf = await buildInternetBillPdf(
          caseData,
          String(body?.umobileImageId ?? "").trim(),
        );
        break;
      }
      case "utility_bill":
        pdf = await generateUtilityBill(caseData);
        break;
      case "tenancy_agreement":
      case "authorization_letter": {
        const ctx = await createTaAuthContext({
          tenantName: source.fullName,
          partiesSeed: parsePartiesSeed(body?.partiesSeed),
        });
        pdf = type === "tenancy_agreement"
          ? await generateTenancyAgreement(
              caseData,
              undefined,
              ctx.now,
              ctx.rng,
              { parties: ctx.parties, signature: ctx.signature, signatures: ctx.signatures },
            )
          : await generateAuthorizationLetter(caseData, ctx.now, {
              parties: ctx.parties,
              signature: ctx.signature,
              rng: ctx.rng,
            });
        break;
      }
      case "time_invoice":
        pdf = await generateTimeInvoice(caseData);
        break;
    }

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${generatedFilename(type, seed)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("Order document generation failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
