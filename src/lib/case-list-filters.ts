export type CaseDateField = "case_created_at" | "updated_at";

export const CASE_DATE_RANGE_ERROR = "To cannot be before From";

export function parseCaseDateField(raw: string | null | undefined): CaseDateField {
  return raw === "updated_at" ? "updated_at" : "case_created_at";
}

/** YYYY-MM-DD strings compare lexicographically. Open-ended ranges are valid. */
export function isInvalidCaseDateRange(from: string, to: string): boolean {
  return Boolean(from && to && to < from);
}

export function caseDateFilterBounds(dateField: CaseDateField, dateFrom: string, dateTo: string) {
  const onCreated = dateField === "case_created_at";
  return {
    createdFrom: onCreated ? dateFrom : "",
    createdTo: onCreated ? dateTo : "",
    updatedFrom: onCreated ? "" : dateFrom,
    updatedTo: onCreated ? "" : dateTo,
  };
}

export function setCaseListQueryParams(
  params: URLSearchParams,
  filters: {
    search?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    dateField?: CaseDateField;
  },
) {
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  params.set("date_field", filters.dateField ?? "case_created_at");
}
