import { describe, it, expect } from "vitest";
import { parseDomestic, domesticSourceId, normalizeDomesticTiers } from "./parseDomestic";
import { sourceById } from "./sources";
import type { SourceSite } from "./sources";

const doradora = sourceById("doradora") as SourceSite;
const pinkbox = sourceById("pinkbox") as SourceSite;

const IMG = "https://doradora.kr/web/product/big/202401/a.jpg";

function payload(over: Record<string, unknown> = {}) {
  return {
    url: "https://doradora.kr/product/test/1234/category/1/display/1/",
    site: "doradora",
    extracted: {
      productNo: "1234",
      title: "테스트 상품",
      mainImages: [IMG],
      detailImages: ["https://doradora.kr/web/product/big/202401/d1.jpg"],
      optionImages: [],
      price: 12000,
      attributes: [{ label: "제조사", value: "테스트" }],
      ...over,
    },
  };
}

describe("domesticSourceId — 도매처별 번호 충돌 방지", () => {
  it("도매처 id 를 앞에 붙인다", () => {
    expect(domesticSourceId("doradora", "1234")).toBe("doradora:1234");
  });

  it("같은 번호라도 도매처가 다르면 다른 키가 된다", () => {
    // 쇼핑몰마다 1번부터 번호를 매기므로 접두사가 없으면
    // 두 번째 도매처의 1234번이 "이미 수집된 상품"으로 거부된다
    expect(domesticSourceId("doradora", "1234")).not.toBe(domesticSourceId("pinkbox", "1234"));
  });
});

describe("normalizeDomesticTiers — 매입가", () => {
  it("단일 가격을 최소수량 1 구간으로 환산한다", () => {
    expect(normalizeDomesticTiers(undefined, 12000)).toEqual([{ minQty: 1, price: 12000 }]);
  });

  it("구간가가 있으면 그대로 쓴다", () => {
    expect(normalizeDomesticTiers([{ minQty: 10, price: 9000 }], 12000)).toEqual([
      { minQty: 10, price: 9000 },
    ]);
  });

  it("가격을 못 찾았으면 빈 배열 — 0원이 매입가로 기록되지 않는다", () => {
    expect(normalizeDomesticTiers(undefined, 0)).toEqual([]);
    expect(normalizeDomesticTiers(undefined, "가격 문의")).toEqual([]);
  });
});

describe("parseDomestic", () => {
  it("정상 payload 를 초안으로 만든다", () => {
    const r = parseDomestic(payload(), doradora);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.source).toBe("doradora");
    expect(r.draft.sourceId).toBe("doradora:1234");
    expect(r.draft.rawTitle).toBe("테스트 상품");
    expect(r.draft.tiers).toEqual([{ minQty: 1, price: 12000 }]);
    expect(r.draft.rawAttributes).toEqual([{ label: "제조사", value: "테스트" }]);
  });

  it("상품번호가 없으면 수집하지 않는다", () => {
    // 중복 판정 키라서, 임의 값으로 채우면 같은 상품이 계속 새로 등록된다
    const r = parseDomestic(payload({ productNo: "" }), doradora);
    expect(r.ok).toBe(false);
  });

  it("상품번호에 이상한 문자가 섞이면 거부한다", () => {
    expect(parseDomestic(payload({ productNo: "12/34" }), doradora).ok).toBe(false);
    expect(parseDomestic(payload({ productNo: "a".repeat(50) }), doradora).ok).toBe(false);
  });

  it("이미지가 한 장도 없으면 수집하지 않는다", () => {
    const r = parseDomestic(payload({ mainImages: [], detailImages: [] }), doradora);
    expect(r.ok).toBe(false);
  });

  it("다른 도매처 호스트의 이미지는 버린다 (SSRF·오수집 방어)", () => {
    // 핑크박스 화이트리스트로 도라도라 이미지를 통과시키면 안 된다
    const r = parseDomestic(payload({ detailImages: [] }), pinkbox);
    expect(r.ok).toBe(false);
  });

  it("내부망 주소는 통과하지 못한다", () => {
    const r = parseDomestic(
      payload({
        mainImages: ["http://127.0.0.1/a.jpg", "https://169.254.169.254/a.png"],
        detailImages: [],
      }),
      doradora,
    );
    expect(r.ok).toBe(false);
  });

  it("도라도라를 사칭하는 호스트를 거부한다", () => {
    const r = parseDomestic(
      payload({ mainImages: ["https://doradora.kr.evil.net/a.jpg"], detailImages: [] }),
      doradora,
    );
    expect(r.ok).toBe(false);
  });

  it("카페24 CDN 이미지는 통과한다", () => {
    const r = parseDomestic(
      payload({ mainImages: ["https://ecimg.cafe24img.com/x/a.jpg"], detailImages: [] }),
      doradora,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.mainImages).toEqual(["https://ecimg.cafe24img.com/x/a.jpg"]);
  });

  it("이미지가 아닌 주소는 버린다", () => {
    const r = parseDomestic(
      payload({ mainImages: ["https://doradora.kr/script.js"], detailImages: [] }),
      doradora,
    );
    expect(r.ok).toBe(false);
  });

  it("대표·상세·옵션에 같은 이미지가 겹치면 한 번만 남긴다", () => {
    // 겹친 채로 두면 같은 사진이 상품 상세에 두 번 뜬다
    const r = parseDomestic(
      payload({ mainImages: [IMG], detailImages: [IMG], optionImages: [IMG] }),
      doradora,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.mainImages).toEqual([IMG]);
    expect(r.draft.detailImages).toEqual([]);
    expect(r.draft.optionImages).toEqual([]);
  });

  it("북마클릿이 실제로 뽑아낸 payload 를 그대로 받는다", () => {
    // 카페24 구조의 상품페이지에 북마클릿을 돌려 나온 실제 출력.
    // 북마클릿과 파서의 필드 이름이 어긋나면 여기서 걸린다 —
    // 양쪽을 따로 고치다 payload 키가 엇갈리는 게 이 구조의 흔한 사고다.
    const real = {
      url: "https://doradora.kr/product/test/5678/category/1/display/1/",
      site: "doradora",
      extracted: {
        productNo: "5678",
        title: "테스트 진동기 실리콘 10단",
        mainImages: [
          "https://doradora.kr/web/product/big/202401/main1.jpg",
          "https://ecimg.cafe24img.com/x/202401/main3.jpg",
        ],
        detailImages: [
          "https://doradora.kr/web/upload/detail/d1.jpg",
          "https://doradora.kr/web/upload/detail/d4.gif",
        ],
        optionImages: ["https://doradora.kr/web/product/tiny/202401/opt_pink.jpg"],
        price: 18500,
        attributes: [{ label: "제조사", value: "테스트상사" }],
      },
    };
    const r = parseDomestic(real, doradora);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.sourceId).toBe("doradora:5678");
    expect(r.draft.rawTitle).toBe("테스트 진동기 실리콘 10단");
    expect(r.draft.mainImages).toHaveLength(2);
    expect(r.draft.detailImages).toHaveLength(2);
    expect(r.draft.optionImages).toHaveLength(1);
    expect(r.draft.tiers).toEqual([{ minQty: 1, price: 18500 }]);
  });

  it("레드그룹 payload — .img 확장자와 speedgabia 호스트를 받는다", () => {
    // 실측 gcode=1858: 대표는 speedgabia 의 .img(내용물은 GIF), 상세는 .jpg.
    // 형식 검증은 미러링 때 매직 바이트로 하므로 확장자는 1차 필터만 한다.
    const redgroup = sourceById("redgroup") as SourceSite;
    const r = parseDomestic(
      {
        url: "https://redgroup.co.kr/pages/page_714.php?cat_id=414&gcode=1858",
        site: "redgroup",
        extracted: {
          productNo: "1858",
          title: "[[한국총판]-최저가준수] [OTOUCH] 플레저 엔진",
          mainImages: ["https://redlove.speedgabia.com/pages/upload/shop/goods_m136_1858_L.img"],
          detailImages: ["https://redlove.speedgabia.com/products/pleasure_engine_st.jpg"],
          optionImages: [],
          price: 84000,
          attributes: [],
        },
      },
      redgroup,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.sourceId).toBe("redgroup:1858");
    expect(r.draft.mainImages).toHaveLength(1);
    expect(r.draft.detailImages).toHaveLength(1);
    expect(r.draft.tiers).toEqual([{ minQty: 1, price: 84000 }]);
  });

  it("쿼리스트링은 떼어 같은 이미지를 두 번 받지 않는다", () => {
    const r = parseDomestic(
      payload({ mainImages: [IMG, `${IMG}?v=2`], detailImages: [] }),
      doradora,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.mainImages).toEqual([IMG]);
  });
});
