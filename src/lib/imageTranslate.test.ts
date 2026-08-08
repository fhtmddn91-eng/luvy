import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseOcrBoxes,
  pickWeight,
  sanitizeSymbols,
  toPixelBox,
  hasHanzi,
  mergeDuplicateFrames,
} from "./imageTranslate";

describe("parseOcrBoxes — 모델 응답 검증", () => {
  const valid = {
    box: [100, 200, 300, 800],
    zh: "产品信息",
    ko: "제품 정보",
    bg: "#ffffff",
    fg: "#000000",
    bold: true,
    solid_bg: true,
  };

  it("정상 항목을 통과시킨다", () => {
    const r = parseOcrBoxes([valid]);
    expect(r).toHaveLength(1);
    expect(r[0].ko).toBe("제품 정보");
    expect(r[0].bold).toBe(true);
  });

  it("좌표가 범위(0~1000) 밖이거나 뒤집힌 항목은 버린다", () => {
    expect(parseOcrBoxes([{ ...valid, box: [100, 200, 300, 1500] }])).toHaveLength(0);
    expect(parseOcrBoxes([{ ...valid, box: [300, 200, 100, 800] }])).toHaveLength(0); // ymax < ymin
    expect(parseOcrBoxes([{ ...valid, box: [100, 200, 300] }])).toHaveLength(0);
  });

  it("색상이 hex 가 아니면 안전한 기본색으로 바꾼다 (스타일 주입 방지)", () => {
    const r = parseOcrBoxes([{ ...valid, bg: "url(javascript:x)", fg: "red;}" }]);
    expect(r[0].bg).toBe("#ffffff");
    expect(r[0].fg).toBe("#000000");
  });

  it("원문·번역이 비었거나 배열이 아니면 버린다", () => {
    expect(parseOcrBoxes([{ ...valid, ko: "" }])).toHaveLength(0);
    expect(parseOcrBoxes([{ ...valid, zh: "" }])).toHaveLength(0);
    expect(parseOcrBoxes("not-array")).toHaveLength(0);
    expect(parseOcrBoxes(null)).toHaveLength(0);
  });

  it("solid_bg 가 불명확하면 단색으로 취급한다 (사각형 덮기가 안전한 기본값)", () => {
    const r = parseOcrBoxes([{ ...valid, solid_bg: undefined }]);
    expect(r[0].solid_bg).toBe(true);
  });
});

describe("pickWeight — 제목/본문 굵기 위계", () => {
  it("굵은 큰 글자는 ExtraBold, 굵은 작은 글자는 Bold", () => {
    expect(pickWeight(true, 90)).toBe("ExtraBold");
    expect(pickWeight(true, 20)).toBe("Bold");
  });
  it("일반 큰 글자는 SemiBold, 본문은 Regular", () => {
    expect(pickWeight(false, 60)).toBe("SemiBold");
    expect(pickWeight(false, 18)).toBe("Regular");
    expect(pickWeight(undefined, 18)).toBe("Regular");
  });
});

describe("sanitizeSymbols — 폰트에 없는 기호 치환", () => {
  it("⩽ 가 네모로 깨지던 실사례를 막는다", () => {
    expect(sanitizeSymbols("⩽56dB")).toBe("≤56dB");
    expect(sanitizeSymbols("A⩾B、C")).toBe("A≥B, C");
  });
});

describe("hasHanzi — 번역문 한자 잔류 검출", () => {
  it("한자가 남으면(폰트에서 네모로 깨진 실사례) 잡아낸다", () => {
    expect(hasHanzi("체내 伸縮")).toBe(true);
    expect(hasHanzi("고속 신축")).toBe(false);
    expect(hasHanzi("3.7V/600mAh ≤56dB")).toBe(false);
  });
});

describe("mergeDuplicateFrames — GIF 중복 프레임 병합", () => {
  it("연속 중복을 합치고 지연시간을 합산한다 (재생 속도 유지)", () => {
    // 실사례: 15프레임 중 연속 중복 3쌍 → sharp 가 지연 합산 없이 12프레임으로 줄였다
    const r = mergeDuplicateFrames(["a", "b", "b", "c"], [100, 100, 100, 100]);
    expect(r.keep).toEqual([0, 1, 3]);
    expect(r.delays).toEqual([100, 200, 100]);
  });

  it("delay 0 은 브라우저 기본값(100ms)으로 취급해 합산한다", () => {
    const r = mergeDuplicateFrames(["a", "a", "b"], [0, 0, 0]);
    expect(r.keep).toEqual([0, 2]);
    expect(r.delays).toEqual([200, 100]);
  });

  it("중복이 없으면 그대로 둔다", () => {
    const r = mergeDuplicateFrames(["a", "b", "a"], [50, 60, 70]);
    expect(r.keep).toEqual([0, 1, 2]);
    expect(r.delays).toEqual([50, 60, 70]);
  });
});

describe("toPixelBox — 좌표 변환 + 여백", () => {
  it("정규화 좌표를 픽셀로 바꾸고 6% 여백을 준다 (원문 잔상 방지)", () => {
    const b = toPixelBox([0, 0, 500, 1000], 800, 400);
    expect(b.x0).toBe(0); // 경계 밖으로 못 나간다
    expect(b.y0).toBe(0);
    expect(b.x1).toBe(800);
    expect(b.y1).toBeGreaterThan(200); // 200 + 여백
    expect(b.y1).toBeLessThanOrEqual(400);
  });
});
