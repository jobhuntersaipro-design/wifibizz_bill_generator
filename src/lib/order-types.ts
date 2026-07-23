// Shared order types/constants usable from both client components and the
// "use server" actions file (which may only export async functions).

export const MAX_DOCS = 10;

export interface OrderDocument {
  type: string; // id | utility_bill | other
  url: string;
  filename: string;
}

export interface OrderListItem {
  id: string;
  fullName: string;
  idType: string;
  idNumber: string;
  offerName: string | null;
  city: string | null;
  state: string | null;
  status: string; // draft | submitting | submitted | failed
  orderId: string | null;
  errorMessage: string | null;
  docCount: number;
  createdAt: string;
}
