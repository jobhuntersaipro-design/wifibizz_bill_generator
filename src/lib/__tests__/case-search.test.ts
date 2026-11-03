import { describe, expect, it } from "vitest";
import { caseSearchPattern } from "../case-search";

describe("caseSearchPattern", () => {
  it("is blank for blank input", () => {
    expect(caseSearchPattern("   ")).toBe("");
  });
  it("lets any spacing match between words", () => {
    expect(caseSearchPattern(" Premium  Value With Device TV 65inch RM189 ")).toBe(
      "%Premium%Value%With%Device%TV%65inch%RM189%",
    );
  });
  it("treats %, _ and \\ as literal characters", () => {
    expect(caseSearchPattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
});
