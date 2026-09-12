import { describe, expect, it } from "vitest";
import { decodeCustomerName, decodeHtmlEntities } from "../html-entities";
import { formatCustomerName } from "../chat-script";

describe("decodeHtmlEntities", () => {
  it("is a general decoder, not a replace of &#039; alone", () => {
    expect(decodeHtmlEntities("&quot;")).toBe('"');
    expect(decodeHtmlEntities("&amp;")).toBe("&");
    expect(decodeHtmlEntities("&#39;")).toBe("'");
    expect(decodeHtmlEntities("&#039;")).toBe("'");
    expect(decodeHtmlEntities("&#x27;")).toBe("'");
    expect(decodeHtmlEntities("&apos;")).toBe("'");
    expect(decodeHtmlEntities("A &amp; B &quot;C&quot;")).toBe('A & B "C"');
  });

  it("leaves a name without entities unchanged", () => {
    expect(decodeHtmlEntities("MUHAMMAD SAHINU BIN INSANU")).toBe(
      "MUHAMMAD SAHINU BIN INSANU",
    );
  });

  it("leaves unknown named entities intact", () => {
    expect(decodeHtmlEntities("&notanentity;")).toBe("&notanentity;");
  });
});

describe("decodeCustomerName / formatCustomerName", () => {
  // Golden case 02634395 — portal stored YA&#039;ASAK via Laravel htmlspecialchars.
  it("prints SITI AYESAH BINTI YA'ASAK from the crawled entity form", () => {
    const stored = "SITI AYESAH BINTI YA&#039;ASAK";
    expect(decodeCustomerName(stored)).toBe("SITI AYESAH BINTI YA'ASAK");
    expect(formatCustomerName(stored)).toBe("SITI AYESAH BINTI YA'ASAK");
    expect(formatCustomerName(stored)).not.toMatch(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/);
  });

  it("dashes a blank name for chat scripts", () => {
    expect(formatCustomerName("")).toBe("—");
    expect(formatCustomerName("   ")).toBe("—");
    expect(formatCustomerName(null)).toBe("—");
  });
});
