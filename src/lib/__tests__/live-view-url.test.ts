import { describe, expect, it } from "vitest";
import { liveViewUrl } from "@/lib/live-view-url";

describe("live view URL", () => {
  it("builds the droplet URL with the token encoded", () => {
    expect(liveViewUrl("https://scraper.example", "j1", "a.b.c")).toBe("https://scraper.example/jobs/j1/live?token=a.b.c");
    expect(liveViewUrl("https://scraper.example/", "j 1", "x", true)).toBe("https://scraper.example/jobs/j%201/live?token=x&probe=1");
  });
});
