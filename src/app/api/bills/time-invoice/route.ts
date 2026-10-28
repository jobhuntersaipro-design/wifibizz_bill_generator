import { generateTimeInvoice } from "@/lib/bill-generator/time-invoice";
import { serveCaseDocument } from "@/lib/case-document-response";

/** GET /api/bills/time-invoice?case_no=… */
export function GET(request: Request) {
  return serveCaseDocument(request, { generate: generateTimeInvoice, filePrefix: "time_invoice", noun: "invoice" });
}
