import { describe, it, expect } from "vitest";
import {
  buildDomesticBookmarkletSource,
  domesticBookmarkletHref,
  domesticSiteTable,
} from "./bookmarkletDomestic";
import { SOURCES } from "./sources";

const SRC = buildDomesticBookmarkletSource();

describe("국내 수집 북마클릿", () => {
  it("북마크 버튼은 서버에서 최신 코드를 받아 실행하는 로더다", () => {
    const href = domesticBookmarkletHref();
    expect(href.startsWith("javascript:")).toBe(true);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain("/bookmarklet-domestic.js?ts=");
    expect(decoded).toContain("createElement('script')");
    // 소스 통째 박제 방식으로 회귀하지 않았는지 (로더는 짧아야 한다)
    expect(decoded.length).toBeLessThan(600);
  });

  it("1688 북마클릿과 다른 주소를 쓴다", () => {
    // 같은 주소를 쓰면 한쪽 배포가 다른 쪽 북마크를 덮어쓴다
    expect(domesticBookmarkletHref()).not.toContain("/bookmarklet.js?");
  });

  it("판별표에 국내 도매처가 모두 들어 있고 1688 은 빠진다", () => {
    const table = JSON.parse(domesticSiteTable()) as { id: string }[];
    const ids = table.map((t) => t.id);
    for (const s of SOURCES) {
      if (s.id === "1688") expect(ids).not.toContain(s.id);
      else expect(ids).toContain(s.id);
    }
  });

  it("판별표가 sources.ts 에서 생성된다 (손으로 복사한 목록이 아님)", () => {
    // 손으로 복사해두면 서버 화이트리스트와 북마클릿이 따로 놀아,
    // "수집은 됐는데 이미지가 한 장도 안 받아지는" 상태가 된다
    const table = JSON.parse(domesticSiteTable()) as { id: string; imageHost: string }[];
    for (const row of table) {
      const site = SOURCES.find((s) => s.id === row.id);
      expect(row.imageHost).toBe(site?.imageHost.source);
    }
  });

  it("등록되지 않은 사이트에서는 아무것도 수집하지 않는다", () => {
    expect(SRC).toContain("등록되지 않은 사이트입니다");
  });

  it("표준 메타데이터를 DOM 셀렉터보다 먼저 읽는다", () => {
    // 레이아웃 셀렉터부터 뒤지면 스킨을 바꿀 때마다 깨진다
    expect(SRC).toContain("application/ld+json");
    expect(SRC).toContain("og:title");
    expect(SRC).toContain("og:image");
    expect(SRC.indexOf("application/ld+json")).toBeLessThan(SRC.indexOf("#prdDetail"));
  });

  it("카페24 상세·이미지 영역 셀렉터를 가지고 있다", () => {
    expect(SRC).toContain("#prdDetail");
    expect(SRC).toContain("xans-product-image");
    expect(SRC).toContain("span_product_price_text");
  });

  it("상품번호를 못 찾으면 수집을 중단한다", () => {
    // 중복 판정 키라서, 임의 값으로 만들면 같은 상품이 계속 새로 등록된다
    expect(SRC).toContain("상품 상세페이지가 아닙니다");
  });

  it("쇼핑몰 UI 이미지(아이콘·배너·스킨)를 걸러낸다", () => {
    expect(SRC).toContain("echosting");
    expect(SRC).toContain("skin");
    expect(SRC).toContain("JUNK_AREA");
  });

  it("지연 로딩 이미지의 data-* 주소를 읽는다", () => {
    // src 만 보면 스크롤 안 한 구간이 통째로 빠진다
    expect(SRC).toContain("data-src");
    expect(SRC).toContain("ec-data-src");
  });

  it("결과 payload 에 도매처 id 를 함께 넣는다", () => {
    expect(SRC).toContain("site: site.id");
  });

  it("문법이 깨지지 않았다", () => {
    // 문자열로 만드는 코드라 이스케이프 실수가 배포까지 살아 나간다
    expect(() => new Function(SRC)).not.toThrow();
  });

  // ---- 리보스(자체 제작 몰) 실측 대응 — 2026-08 실페이지 K-579 에서 확인한 것들 ----

  it("리보스 상품번호: p_view.php 의 p= 코드를 잡는다", () => {
    expect(SRC).toContain("p_view");
  });

  it("리보스 이미지: cafe24 상세이미지 호스트가 화이트리스트에 있다", () => {
    // 상세이미지가 rebossshop.cafe24.com 에 있다 — sources.ts 에서 안 열면 전부 버려진다
    const table = JSON.parse(domesticSiteTable()) as { id: string; imageHost: string }[];
    const ribos = table.find((r) => r.id === "ribos");
    expect(new RegExp(ribos!.imageHost, "i").test("rebossshop.cafe24.com")).toBe(true);
    expect(new RegExp(ribos!.imageHost, "i").test("admin.oxox.co.kr")).toBe(true);
  });

  it("확장자 없는 주소는 세지 않는다 (서버 검사와 일치)", () => {
    // 리보스 투명 스페이서(product/uvblankgif)가 상세이미지 2장 중 1장으로
    // 세어졌다 — 서버가 버리는 걸 북마클릿이 세면 알림 장수가 거짓말이 된다
    expect(SRC).toContain("uvblankgif");
  });

  it("리보스 상품명·매입가 폴백이 들어 있다", () => {
    expect(SRC).toContain("권장판매가");   // "K-579 상품명 [권장판매가:...]" 파싱
    expect(SRC).toContain("판매가격");     // "판매가격 : 290,000원" 라벨 스캔
    expect(SRC).toContain("상품");        // 본문 "상품코드 : K-579" 폴백
  });

  // ---- 레드그룹(자체 제작 몰) 실측 대응 — 2026-08 실페이지 gcode=1858 ----

  it("레드그룹 상품번호·영역 셀렉터가 들어 있다", () => {
    expect(SRC).toContain("gcode");        // page_714.php?cat_id=414&gcode=1858
    expect(SRC).toContain("shop_view");    // 대표이미지 모듈 #shop_view_136
    expect(SRC).toContain("goods_detail"); // 상세설명 영역 #goods_detail
    expect(SRC).toContain("price_text");   // 판매가 자리 (최저판매가와 구분)
  });

  it("추천 위젯(notice)을 걸러 옆 상품이 섞이지 않는다", () => {
    // 상세페이지의 신상품 위젯(#notice_864)에 다른 상품 대표이미지 18장이
    // 큰 크기로 들어 있다(실측) — 안 거르면 엉뚱한 상품 사진이 등록된다
    expect(SRC).toContain('[id*="notice"]');
  });

  it(".img 확장자(speedgabia)를 이미지로 인정한다", () => {
    expect(SRC).toContain("|img)$");
  });
});
