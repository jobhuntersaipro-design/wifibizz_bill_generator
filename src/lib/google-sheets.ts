import { google } from "googleapis";

function getAuth() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set");
  }
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export function getServiceAccountEmail(): string | null {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentials) return null;
  try {
    const parsed = JSON.parse(credentials);
    return parsed.client_email || null;
  } catch {
    return null;
  }
}

const HEADERS = [
  "Case No.",
  "Name",
  "Mobile",
  "Email",
  "IC/ID No.",
  "Provider",
  "Package",
  "Order No.",
  "Agent",
  "Agent Remark",
  "Status",
  "Address",
  "Case Created At",
  "Synced At",
  "Final Status",
];

interface CaseData {
  caseNo: string;
  fullName: string | null;
  mobile: string | null;
  email: string | null;
  idNo: string | null;
  provider: string | null;
  package: string | null;
  orderNo: string | null;
  agent: string | null;
  agentRemark: string | null;
  status: string | null;
  fullAddress: string | null;
  caseCreatedAt: Date | null;
}

function caseToRow(c: CaseData): string[] {
  return [
    c.caseNo,
    c.fullName ?? "",
    c.mobile ?? "",
    c.email ?? "",
    c.idNo ?? "",
    c.provider ?? "",
    c.package ?? "",
    c.orderNo ?? "",
    c.agent ?? "",
    c.agentRemark ?? "",
    c.status ?? "",
    c.fullAddress ?? "",
    c.caseCreatedAt ? c.caseCreatedAt.toISOString() : "",
    new Date().toISOString(),
    "", // Final Status — left blank for user to fill in
  ];
}

export async function appendCasesToSheet(
  sheetId: string,
  cases: CaseData[]
): Promise<{ appendedRows: number }> {
  if (cases.length === 0) return { appendedRows: 0 };

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Check if sheet has headers already
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Sheet1!A1:O1",
  });

  const hasHeaders =
    existing.data.values && existing.data.values.length > 0;

  const rows: string[][] = [];
  if (!hasHeaders) {
    rows.push(HEADERS);
  }
  rows.push(...cases.map(caseToRow));

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Sheet1!A:O",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  return { appendedRows: cases.length };
}

/**
 * Patch the Address column (L) for cases already in the sheet whose address was
 * filled AFTER they were first synced (append-only never updates an existing row).
 * Reads case_no (A) + current Address (L), and batch-updates only the cells whose
 * DB address is non-empty and differs from the sheet. Returns how many were updated.
 */
export async function updateSheetAddresses(
  sheetId: string,
  cases: { caseNo: string; fullAddress: string | null }[]
): Promise<{ updated: number }> {
  const withAddr = cases.filter((c) => c.fullAddress && c.fullAddress.trim());
  if (withAddr.length === 0) return { updated: 0 };

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Read case numbers (A) + current addresses (L) with their row positions.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Sheet1!A:L",
  });
  const rows = res.data.values ?? [];
  const rowByCase = new Map<string, { row: number; addr: string }>();
  for (let i = 1; i < rows.length; i++) {
    // skip header
    const caseNo = (rows[i]?.[0] ?? "").toString().trim();
    if (!caseNo) continue;
    const addr = (rows[i]?.[11] ?? "").toString(); // column L (index 11) = Address
    rowByCase.set(caseNo, { row: i + 1, addr });
  }

  const data: { range: string; values: string[][] }[] = [];
  for (const c of withAddr) {
    const hit = rowByCase.get(c.caseNo);
    if (hit && hit.addr.trim() !== c.fullAddress!.trim()) {
      data.push({ range: `Sheet1!L${hit.row}`, values: [[c.fullAddress!]] });
    }
  }
  if (data.length === 0) return { updated: 0 };

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
  return { updated: data.length };
}

/**
 * Read all case numbers currently in the sheet (column A, skipping header).
 * Used to detect rows manually deleted by the user.
 */
export async function getSheetCaseNumbers(
  sheetId: string
): Promise<Set<string>> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Sheet1!A:A",
  });

  const rows = result.data.values ?? [];
  const caseNumbers = new Set<string>();
  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const val = rows[i]?.[0]?.trim();
    if (val) caseNumbers.add(val);
  }
  return caseNumbers;
}
