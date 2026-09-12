export type CaseDateField = "case_created_at" | "updated_at";

export function parseCaseDateField(raw: string | null | undefined): CaseDateField {
  return raw === "updated_at" ? "updated_at" : "case_created_at";
}

/** YYYY-MM-DD strings compare lexicographically. Pull To up to From when inverted. */
export function clampCaseDateRange(from: string, to: string): { dateFrom: string; dateTo: string } {
  if (from && to && to < from) return { dateFrom: from, dateTo: from };
  return { dateFrom: from, dateTo: to };
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
