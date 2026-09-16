/** The droplet URL the browser opens. `probe` asks for a JSON verdict instead of the stream. */
export function liveViewUrl(scraperUrl: string, jobId: string, token: string, probe = false): string {
  const base = scraperUrl.replace(/\/+$/, "");
  const q = `token=${encodeURIComponent(token)}${probe ? "&probe=1" : ""}`;
  return `${base}/jobs/${encodeURIComponent(jobId)}/live?${q}`;
}
