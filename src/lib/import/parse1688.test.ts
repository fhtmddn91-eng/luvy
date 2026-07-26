import { describe, it, expect } from "vitest";
import { parse1688, normalizeImageUrl, toOriginalImageUrl, extractOfferId } from "./parse1688";

const IMG = "https://cbu01.alicdn.com/img/ibank/O1CN01abc.jpg";
const GIF = "https://cbu01.alicdn.com/img/ibank/O1CN01move.gif";

describe("toOriginalImageUrl", () => {
  it("리사이즈 접미사를 떼어 원본 경로를 만든다", () => {
    expect(toOriginalImageUrl(`${IMG}_220x220.jpg`)).toBe(IMG);
    expect(toOriginalImageUrl(`${IMG}_q50.jpg`)).toBe(IMG);
  });

  it("GIF가 정적 webp로 변환된 URL을 애니메이션 원본으로 되돌린다", () => {
    expect(toOriginalImageUrl(`${GIF}_.webp`)).toBe(GIF);
    expect(toOriginalImageUrl(`${GIF}_400x400.webp`)).toBe(GIF);
  });

  it("접미사가 없으면 그대로 둔다", () => {
    expect(toOriginalImageUrl(IMG)).toBe(IMG);
  });
});

describe("normalizeImageUrl — SSRF 차단", () => {
  it("alicdn 이미지를 허용한다", () => {
    expect(normalizeImageUrl(IMG)).toBe(IMG);
    expect(normalizeImageUrl(`//cbu01.alicdn.com/img/a.png_80x80.png`)).toBe(
      "https://cbu01.alicdn.com/img/a.png",
    );
  });

  it("alicdn 이외 호스트는 거부한다", () => {
    expect(normalizeImageUrl("https://evil.example.com/a.jpg")).toBeNull();
    // 접미사 매칭으로 우회하려는 시도
    expect(normalizeImageUrl("https://alicdn.com.evil.io/a.jpg")).toBeNull();
  });

  it("내부망·비HTTPS·비이미지를 거부한다", () => {
    expect(normalizeImageUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(normalizeImageUrl("https://cbu01.alicdn.com/script.js")).toBeNull();
    expect(normalizeImageUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeImageUrl(null)).toBeNull();
  });
});

describe("extractOfferId", () => {
  it("상세 URL에서 offerId를 뽑는다", () => {
    expect(extractOfferId("https://detail.1688.com/offer/123456789.html")).toBe("123456789");
    expect(extractOfferId("https://detail.1688.com/offer/987654321.html?spm=a1")).toBe("987654321");
    expect(extractOfferId("https://m.1688.com/x?offerId=555666777")).toBe("555666777");
  });

  it("상품 상세가 아니면 null", () => {
    expect(extractOfferId("https://www.1688.com/")).toBeNull();
  });
});

describe("parse1688", () => {
  const base = {
    url: "https://detail.1688.com/offer/123456789.html",
    extracted: {
      offerId: "123456789",
      title: "情趣女仆装 蕾丝套装",
      mainImages: [`${IMG}_400x400.jpg`, IMG], // 정규화 후 중복
      detailImages: [`${GIF}_.webp`, "https://cbu02.alicdn.com/img/d1.jpg"],
      optionImages: ["https://cbu01.alicdn.com/img/opt.jpg_60x60.jpg"],
      tiers: [
        { minQty: 50, price: 18.5 },
        { minQty: 2, price: 25.0 },
        { minQty: 2, price: 99 }, // 중복 수량
      ],
      attributes: [{ label: "材质", value: "涤纶" }],
    },
  };

  it("정상 payload를 초안으로 변환한다", () => {
    const r = parse1688(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.sourceId).toBe("123456789");
    expect(r.draft.rawTitle).toBe("情趣女仆装 蕾丝套装");
    expect(r.draft.rawAttributes).toEqual([{ label: "材质", value: "涤纶" }]);
  });

  it("이미지를 원본화하고 중복을 제거한다", () => {
    const r = parse1688(base);
    if (!r.ok) throw new Error("expected ok");
    expect(r.draft.mainImages).toEqual([IMG]);
    // GIF는 애니메이션 원본으로 복원되어야 한다
    expect(r.draft.detailImages[0]).toBe(GIF);
  });

  it("가격 티어를 수량 오름차순으로 정렬하고 중복 수량을 버린다", () => {
    const r = parse1688(base);
    if (!r.ok) throw new Error("expected ok");
    expect(r.draft.tiers).toEqual([
      { minQty: 2, price: 25.0 },
      { minQty: 50, price: 18.5 },
    ]);
    expect(r.draft.moq).toBe(2); // 최소 티어 수량이 MOQ
  });

  it("offerId가 없으면 실패 사유를 알려준다", () => {
    const r = parse1688({ url: "https://www.1688.com/" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("상품 번호");
  });

  it("이미지를 하나도 못 찾으면 실패한다", () => {
    const r = parse1688({ url: base.url, extracted: { offerId: "123456789", title: "x" } });
    expect(r.ok).toBe(false);
  });

  it("구조화 데이터가 없어도 HTML에서 이미지를 회수한다", () => {
    const html = `<meta property="og:title" content="测试商品"/>
      <img src="//cbu01.alicdn.com/img/h1.jpg_300x300.jpg">
      <img src="https://evil.example.com/x.jpg">`;
    const r = parse1688({ url: base.url, html });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.rawTitle).toBe("测试商品");
    expect(r.draft.mainImages).toEqual(["https://cbu01.alicdn.com/img/h1.jpg"]);
    // 화이트리스트 밖 호스트는 HTML 경로에서도 걸러진다
    expect(JSON.stringify(r.draft)).not.toContain("evil.example.com");
  });
});
