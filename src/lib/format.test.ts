import { describe, it, expect } from "vitest";
import { won } from "./format";

describe("won", () => {
  it("formats with thousands separators and 원", () => {
    expect(won(6500)).toBe("6,500원");
    expect(won(0)).toBe("0원");
    expect(won(100000)).toBe("100,000원");
  });
});
