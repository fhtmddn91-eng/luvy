import { describe, it, expect } from "vitest";
import { normalizeImageUrl } from "./parse1688";

/**
 * 미러링의 네트워크 구간은 alicdn 실호스트를 타므로 단위 테스트에서 제외한다.
 * 대신 다운로드 직전 마지막 관문인 URL 검증을 여기서 다시 못박는다.
 * (mirror.ts 는 fetch 전에 normalizeImageUrl 을 한 번 더 통과시킨다)
 */
describe("미러링 진입 조건", () => {
  it("내부망 주소는 미러링 대상이 될 수 없다", () => {
    for (const bad of [
      "http://127.0.0.1:5432/",
      "https://localhost/a.jpg",
      "http://169.254.169.254/latest/meta-data/iam/",
      "https://10.0.0.5/a.png",
      "https://[::1]/a.png",
    ]) {
      expect(normalizeImageUrl(bad)).toBeNull();
    }
  });

  it("alicdn 을 사칭하는 호스트를 거부한다", () => {
    for (const bad of [
      "https://alicdn.com.attacker.net/a.jpg",
      "https://notalicdn.com/a.jpg",
      "https://cbu01.alicdn.com.evil/a.jpg",
    ]) {
      expect(normalizeImageUrl(bad)).toBeNull();
    }
  });

  it("정상 alicdn 이미지는 통과한다", () => {
    expect(normalizeImageUrl("https://cbu01.alicdn.com/img/ibank/x.gif_.webp")).toBe(
      "https://cbu01.alicdn.com/img/ibank/x.gif",
    );
  });
});
