import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Case List filter bar and row-open preview", () => {
  it("has an explicit Search submit and Created At / Updated At toggle", async () => {
    const source = await readFile("src/components/dashboard/CaseManagementSection.tsx", "utf8");
    expect(source).toContain('type="submit"');
    expect(source).toMatch(/>\s*Search\s*</);
    expect(source).toContain('title="Press Enter or click Search"');
    expect(source).toContain("Created At");
    expect(source).toContain("Updated At");
    expect(source).toContain('aria-pressed={dateField === "case_created_at"}');
    expect(source).toContain('aria-pressed={dateField === "updated_at"}');
    expect(source).toContain("clampCaseDateRange");
    expect(source).toContain("min={dateFrom || undefined}");
    expect(source).toContain("max={dateTo || undefined}");
  });

  it("clamps inverted From/To on the cases APIs so an invalid range cannot apply", async () => {
    const list = await readFile("src/app/api/cases/route.ts", "utf8");
    const ids = await readFile("src/app/api/cases/ids/route.ts", "utf8");
    expect(list).toContain("clampCaseDateRange");
    expect(ids).toContain("clampCaseDateRange");
  });

  it("opens bill previews inline so a row click does not download", async () => {
    const source = await readFile("src/components/dashboard/CaseManagementSection.tsx", "utf8");
    const internet = source.slice(
      source.indexOf('title="Internet Bill Preview"') - 280,
      source.indexOf('title="Internet Bill Preview"'),
    );
    const utility = source.slice(
      source.indexOf('title="Utility Bill Preview"') - 280,
      source.indexOf('title="Utility Bill Preview"'),
    );
    expect(internet).toContain("preview: true");
    expect(utility).toContain("preview: true");
    expect(source).toContain('onClick={() => setSelectedCase(c)}');
  });
});
