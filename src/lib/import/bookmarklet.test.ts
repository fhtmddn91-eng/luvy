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

  it("구조화 데이터(window.context) 우선 추출이 들어 있다", () => {
    // 대표이미지·상품명·가격·속성은 페이지 전역 데이터에서 먼저 읽는다
    expect(BOOKMARKLET_SOURCE).toContain("offerImgList");
    expect(BOOKMARKLET_SOURCE).toContain("offerDetail");
    expect(BOOKMARKLET_SOURCE).toContain("featureAttributes");
    expect(BOOKMARKLET_SOURCE).toContain("skuModel");
    // 상세이미지는 detailUrl JSONP 로 전체를 받는다 (lazy-load 누락 방지)
    expect(BOOKMARKLET_SOURCE).toContain("detailUrl");
    expect(BOOKMARKLET_SOURCE).toContain("offer_details");
  });

  it("DOM 폴백에서 플랫폼 로고·아이콘을 걸러낸다", () => {
    // 타오바오·JD 로고가 수집된 사고(실제 발생)의 재발 방지
    expect(BOOKMARKLET_SOURCE).toContain("-tps-");
    expect(BOOKMARKLET_SOURCE).toContain("consign");
    expect(BOOKMARKLET_SOURCE).toContain("shop-navigation");
  });
});
