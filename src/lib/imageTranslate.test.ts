import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseOcrBoxes,
  pickWeight,
  sanitizeSymbols,
  toPixelBox,
  hasHanzi,
  mergeDuplicateFrames,
  isVerticalBox,
  isSmallOverlayBox,
  isForeignSource,
  safePad,
  isCrowdedBox,
  extendOverLeftover,
  hasManualOverride,
  borderUniformity,
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

describe("isForeignSource — 번역 대상 원문 판별", () => {
  it("중국어·일본어만 통과, 영어 워터마크는 제외 (실측: LAYLA VIBRATOR 덮임 방지)", () => {
    expect(isForeignSource("内外双激黑科技")).toBe(true);
    expect(isForeignSource("寮では足挟み")).toBe(true);
    expect(isForeignSource("ために設計され")).toBe(true); // 가나만 있는 줄
    expect(isForeignSource("LAYLA VIBRATOR")).toBe(false);
    expect(isForeignSource("FOREPLAY MOMENT TIDE")).toBe(false);
    expect(isForeignSource("216g / 56dB")).toBe(false);
  });
});

describe("박스 분류 — 재생성 패치 vs 오버레이", () => {
  // 실사례 (1440x1440): 일본어 장식 문구 box y599-613 → 높이 약 20px
  const decoBox: [number, number, number, number] = [599, 866, 613, 963];
  // 세로쓰기 "产品代言人" box y587-680 x396-418 → 높이 134px, 폭 32px
  const vertBox: [number, number, number, number] = [587, 396, 680, 418];
  // 큰 제목 box y34-203 → 높이 243px
  const titleBox: [number, number, number, number] = [34, 308, 203, 977];

  it("작은 가로 글씨는 오버레이 대상 (재생성이 뭉개는 영역 — 실측)", () => {
    expect(isSmallOverlayBox(decoBox, 1440, 1440)).toBe(true);
    expect(isSmallOverlayBox(titleBox, 1440, 1440)).toBe(false);
  });

  it("세로쓰기는 오버레이 금지 (재생성이 잘 그리고 오버레이는 못 그림)", () => {
    expect(isVerticalBox(vertBox, 1440, 1440)).toBe(true);
    expect(isSmallOverlayBox(vertBox, 1440, 1440)).toBe(false);
    expect(isVerticalBox(titleBox, 1440, 1440)).toBe(false);
  });
});

describe("safePad — 옆 내용 침범 방지", () => {
  it("가까이 내용이 있으면 그 앞에서 멈춘다 (실사례: 不低于53MIN 의 5 를 덮음)", () => {
    // 박스 오른쪽 5px 지점부터 숫자가 있다 → 여백은 3px 로 줄어야 한다
    expect(safePad((d) => d >= 5, 18)).toBe(3);
  });

  it("바로 옆에 붙어 있으면 여백 0", () => {
    expect(safePad((d) => d >= 1, 18)).toBe(0);
    expect(safePad((d) => d >= 2, 18)).toBe(0);
  });

  it("주변이 비어 있으면 최대 여백을 그대로 쓴다", () => {
    expect(safePad(() => false, 18)).toBe(18);
  });
});

describe("borderUniformity — 배경을 주변에서 추정", () => {
  it("테두리가 거의 같은 색이면 단색으로 보고 그 색을 쓴다", () => {
    const s = [[250, 240, 240], [252, 242, 241], [249, 239, 239]];
    const r = borderUniformity(s);
    expect(r.uniform).toBe(true);
    expect(r.color[0]).toBeGreaterThan(245);
  });

  it("테두리가 크게 변하면 보간으로 처리한다 (사진·그라데이션)", () => {
    const s = [[255, 255, 255], [20, 20, 20], [130, 90, 200]];
    expect(borderUniformity(s).uniform).toBe(false);
  });

  it("표본이 없으면 흰색으로 안전하게 처리한다", () => {
    expect(borderUniformity([])).toEqual({ uniform: true, color: [255, 255, 255] });
  });
});

describe("문구별 수동 조정", () => {
  const base = { box: [100, 200, 300, 800] as [number, number, number, number], zh: "产品信息", ko: "제품 정보", bg: "#fff", fg: "#000" };

  it("지움·유지·위치·크기·굵기를 손대면 재생성 대신 오버레이로 그린다", () => {
    expect(hasManualOverride({ ...base, mode: "erase" })).toBe(true);
    expect(hasManualOverride({ ...base, mode: "keep" })).toBe(true);
    expect(hasManualOverride({ ...base, dx: 5 })).toBe(true);
    expect(hasManualOverride({ ...base, scale: 1.4 })).toBe(true);
    expect(hasManualOverride({ ...base, weight: "Bold" })).toBe(true);
  });

  it("손대지 않았으면 재생성 패치를 쓴다", () => {
    expect(hasManualOverride(base)).toBe(false);
    expect(hasManualOverride({ ...base, mode: "translate", dx: 0, dy: 0, scale: 1 })).toBe(false);
  });

  it("지움 항목은 번역문이 비어도 유효하다 (원문만 지우는 항목)", () => {
    const r = parseOcrBoxes([{ ...base, ko: "", mode: "erase" }]);
    expect(r).toHaveLength(1);
    expect(r[0].mode).toBe("erase");
  });

  it("번역 항목은 문구가 비면 버린다 (실수로 지워지는 사고 방지)", () => {
    expect(parseOcrBoxes([{ ...base, ko: "" }])).toHaveLength(0);
  });

  it("범위를 벗어난 조정값은 무시한다", () => {
    const r = parseOcrBoxes([{ ...base, scale: 99, dx: 99999, weight: "Fake" }]);
    expect(r[0].scale).toBeUndefined();
    expect(r[0].dx).toBeUndefined();
    expect(r[0].weight).toBeUndefined();
  });
});

describe("extendOverLeftover — 잔여 획 덮기", () => {
  it("붙어 있는 잔여 글자를 지나 빈 칸에서 멈춘다 (실사례: 1050MAHH 의 H)", () => {
    expect(extendOverLeftover((d) => d <= 6, 24)).toBe(6);
  });

  it("빈 칸 뒤의 옆 항목은 삼키지 않는다", () => {
    expect(extendOverLeftover((d) => d <= 4 || d >= 7, 24)).toBe(4);
  });

  it("상한을 넘지 않는다", () => {
    expect(extendOverLeftover(() => true, 10)).toBe(10);
  });
});

describe("isCrowdedBox — 옆에 내용이 붙은 문구 판별", () => {
  it("가까이 내용이 있으면 오버레이 대상 (실사례: 不低于53MIN)", () => {
    expect(isCrowdedBox(5, 30)).toBe(true);   // 30px 글자 옆 5px 지점에 숫자
    expect(isCrowdedBox(13, 30)).toBe(true);  // 13 < 13.5
  });

  it("충분히 떨어져 있으면 재생성 패치를 쓴다", () => {
    expect(isCrowdedBox(40, 30)).toBe(false);
    expect(isCrowdedBox(20, 30)).toBe(false);
  });

  it("작은 글자도 최소 10px 는 확보돼야 한다", () => {
    expect(isCrowdedBox(6, 12)).toBe(true);
    expect(isCrowdedBox(12, 12)).toBe(false);
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
