/**
 * Turn an Anthropic API failure into the sentence the chat panel shows.
 *
 * The API's own message is the only thing that says WHY a request was refused
 * ("messages.3.content.0: text content blocks must be non-empty", an unknown
 * parameter, a model the key cannot use). Reporting only the status code
 * ("answered 400") left the cause in the server log, out of reach of the admin
 * testing this feature. The message carries no secret — it describes our own
 * request — and this panel is admin-only.
 */
export function describeApiError(e: {
  status?: number | null;
  error?: unknown;
  message?: string;
  requestID?: string | null;
}): string {
  const body = e.error as { error?: { type?: string; message?: string } } | undefined;
  const detail = body?.error?.message?.trim() || e.message?.trim() || "";
  const text = detail.length > 400 ? `${detail.slice(0, 400)}…` : detail;
  const head = e.status ? `The AI service refused the request (${e.status})` : "The AI service refused the request";
  const req = e.requestID ? ` Request ${e.requestID}.` : "";
  return `${head}${text ? `: ${text.replace(/\s+/g, " ")}` : "."}${req}`;
}
