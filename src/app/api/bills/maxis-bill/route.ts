import { generateMaxisBill } from "@/lib/bill-generator/maxis-bill";
import { serveCaseDocument } from "@/lib/case-document-response";

/** GET /api/bills/maxis-bill?case_no=… */
export function GET(request: Request) {
  return serveCaseDocument(request, { generate: (c) => generateMaxisBill(c), filePrefix: "maxis_bill", noun: "bill" });
}
