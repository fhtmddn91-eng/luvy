import { describe, it, expect } from "vitest";
import { BOOKMARKLET_SOURCE, bookmarkletHref } from "./bookmarklet";

describe("bookmarklet", () => {
  it("북마크 버튼은 서버에서 최신 코드를 받아 실행하는 로더다", () => {
    const href = bookmarkletHref();
    expect(href.startsWith("javascript:")).toBe(true);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    // 추출 코드가 박제되지 않고 /bookmarklet.js 를 매번 새로 부른다
    expect(decoded).toContain("/bookmarklet.js?ts=");
    expect(decoded).toContain("createElement('script')");
    // 소스 통째 박제 방식으로 회귀하지 않았는지 (로더는 짧아야 한다)
    expect(decoded.length).toBeLessThan(600);
  });

  it("추출 코드에 핵심 로직이 들어 있다", () => {
    // 1688 밖에서 실행 방지
    expect(BOOKMARKLET_SOURCE).toContain("1688.com");
    // SSRF 방어: alicdn 이미지만 수집
    expect(BOOKMARKLET_SOURCE).toContain("alicdn");
    // 상품명이 판매사 이름(h1)으로 잡히던 버그의 수정이 유지되는지
    expect(BOOKMARKLET_SOURCE).toContain("offer-title");
    expect(BOOKMARKLET_SOURCE).toContain("阿里巴巴");
    // 새 레이아웃 속성 표 추출
    expect(BOOKMARKLET_SOURCE).toContain("ant-descriptions-row");
  });
});
