import { describe, it, expect } from "vitest";
import { generateTempPassword, TEMP_PASSWORD_LENGTH } from "./tempPassword";

describe("generateTempPassword", () => {
  it("기본 길이로 생성한다", () => {
    expect(generateTempPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
  });

  it("소문자·대문자·숫자가 반드시 하나씩 들어간다", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw, pw).toMatch(/[a-z]/);
      expect(pw, pw).toMatch(/[A-Z]/);
      expect(pw, pw).toMatch(/[0-9]/);
    }
  });

  it("헷갈리는 글자(0,O,1,l,I)는 쓰지 않는다", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it("8자리보다 짧게는 만들지 않는다", () => {
    expect(generateTempPassword(4).length).toBe(8);
  });

  it("같은 rng 를 넣으면 결정적으로 동작한다 (셔플 포함)", () => {
    const seq = (max: number) => 0 % max;
    expect(generateTempPassword(10, seq)).toBe(generateTempPassword(10, seq));
  });
});
