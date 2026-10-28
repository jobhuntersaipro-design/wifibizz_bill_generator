import { generateAlloBill } from "@/lib/bill-generator/allo-bill";
import { serveCaseDocument } from "@/lib/case-document-response";

/** GET /api/bills/allo-bill?case_no=… */
export function GET(request: Request) {
  return serveCaseDocument(request, { generate: (c) => generateAlloBill(c), filePrefix: "allo_bill", noun: "bill" });
}
