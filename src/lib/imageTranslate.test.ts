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
  isForeignSource,
  safePad,
  extendOverLeftover,
  median,
  cleanEdge,
  groupBySize,
  unifySizes,
  hasManualOverride,
  mustOverlay,
  eraseTargets,
  pickTranslated,
  regionIsStatic,
  inventedInBox,
  textBands,
  textCoverage,
  truncatedTail,
  mergeOverlappingBoxes,
  splitTwoLines,
  charBudget,
  brokenWordTail,
  blankedBox,
  regionStdev,
  seamGap,
  contrastStroke,
  planErase,
  stripForeign,
  inpaint,
  percentilePass,
  eraseGlyphs,
  backgroundRef,
  parseJsonArrayLoose,
  choppedGlyphTail,
  remapBandBox,
  dedupeBandBoxes,
  ghostResidue,
  edgeCrossing,
  dropRiskyWm,
  clipRectAgainst,
  regenPromptWithHint,
  unchangedBox,
  gateLeftover,
  type OcrBox,
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

describe("planErase — 지운 자리를 무엇으로 채울지", () => {
  /** 한 변을 같은 색으로 채운 표본 */
  const side = (rgb: [number, number, number], n = 20) => Array.from({ length: n }, () => [...rgb]);
  /** 한 변이 a→b 로 서서히 변하는 표본 */
  const ramp = (a: number, b: number, n = 20) =>
    Array.from({ length: n }, (_, i) => {
      const v = Math.round(a + ((b - a) * i) / (n - 1));
      return [v, v, v];
    });
  const g = (v: number) => [v, v, v] as [number, number, number];

  it("네 변이 같은 색이면 그 색으로 평평하게 칠한다", () => {
    const r = planErase([side(g(250)), side(g(250)), side(g(250)), side(g(250))]);
    expect(r.how).toBe("flat");
    expect(r.how === "flat" && r.color[0]).toBe(250);
  });

  it("위아래 색이 다르면 보간한다 (세로 그라데이션)", () => {
    // 예전 판정은 표본을 한 통에 섞어 퍼짐만 봐서 이걸 단색으로 통과시켰고,
    // 그 결과 노란 띠 위에 밝은 네모 자국이 남았다
    expect(planErase([side(g(240)), side(g(224)), null, null]).how).toBe("blend");
  });

  it("좌우 색이 다르면 보간한다 (사진 배경)", () => {
    expect(planErase([null, null, side(g(255)), side(g(228))]).how).toBe("blend");
  });

  it("배경은 단색인데 한 변만 다른 물체가 스치면 평평하게 칠한다", () => {
    // 실사례: 노란 화살표가 "기능형" 박스 변에 물렸고, 이걸 배경 변화로 오판해
    // 보간하자 화살표 색이 박스 전체로 늘어나 세로 줄무늬가 생겼다
    const bg = g(235);
    const arrow = [
      ...Array.from({ length: 14 }, () => [...bg]),
      ...Array.from({ length: 6 }, () => [250, 220, 120]),
    ];
    const r = planErase([arrow, side(bg), side(bg), side(bg)]);
    expect(r.how).toBe("flat");
    expect(r.how === "flat" && r.color[0]).toBe(235);
  });

  it("한 변이 통째로 옆 줄 글자에 덮여도 나머지로 배경을 잡는다", () => {
    const bg = g(240);
    const r = planErase([side(bg), side(g(25)), side(bg), side(bg)]);
    expect(r.how).toBe("flat");
    expect(r.how === "flat" && r.color[0]).toBe(240);
  });

  it("표본이 없으면 흰색으로 안전하게 처리한다", () => {
    expect(planErase([null, null, null, null])).toEqual({ how: "flat", color: [255, 255, 255] });
  });

  it("완만한 그라데이션은 보간으로 간다", () => {
    expect(planErase([ramp(255, 230), ramp(250, 225), ramp(255, 250), ramp(230, 225)]).how).toBe("blend");
  });
});


describe("eraseGlyphs — 사각형을 칠하지 않고 획만 지운다", () => {
  /** 세로 그라데이션 배경에 검은 가로 막대(=글자 획) 하나를 그린 그림 */
  const make = (W: number, H: number) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = 200 + Math.round((y / H) * 40); // 200 → 240 그라데이션
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    // 획: 가운데 4px 높이의 어두운 막대
    for (let y = 18; y < 22; y++) {
      for (let x = 20; x < 80; x++) {
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 20;
      }
    }
    return d;
  };

  it("획은 배경색으로 덮이고, 획에서 먼 배경은 한 바이트도 안 바뀐다", () => {
    const W = 100, H = 40;
    const before = make(W, H);
    const after = Uint8ClampedArray.from(before);
    expect(eraseGlyphs(after, W, H, { x0: 10, y0: 8, x1: 90, y1: 32 })).toBe(true);

    // 획 자리는 배경 밝기로 돌아왔다
    const at = (x: number, y: number) => after[(y * W + x) * 4];
    expect(at(50, 20)).toBeGreaterThan(180);

    // 예전에는 박스 전체를 칠해서 이 자리들이 전부 바뀌었다 —
    // 이제 획에서 떨어진 배경은 원본 그대로여야 한다
    for (const [x, y] of [[12, 10], [88, 10], [12, 30], [88, 30], [50, 9], [50, 31]]) {
      const i = (y * W + x) * 4;
      expect([after[i], after[i + 1], after[i + 2]]).toEqual([before[i], before[i + 1], before[i + 2]]);
    }
  });

  it("배경과 글자를 가려낼 수 없으면 false — 부르는 쪽이 예전 방식을 쓴다", () => {
    // 박스가 통째로 한 색(예: 단색 버튼 안)이면 획으로 볼 픽셀이 없다
    const W = 40, H = 20;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 30;
      d[i * 4 + 3] = 255;
    }
    expect(eraseGlyphs(d, W, H, { x0: 2, y0: 2, x1: 38, y1: 18 })).toBe(false);
  });
});

describe("inpaint — 주변에서 번져 채우기", () => {
  it("구멍을 이웃 배경값으로 메운다", () => {
    const w = 5, h = 5;
    const ch = new Uint8Array(w * h).fill(100);
    ch[12] = 0; // 가운데
    const mask = new Uint8Array(w * h);
    mask[12] = 255;
    const [out] = inpaint([ch, Uint8Array.from(ch), Uint8Array.from(ch)], mask, w, h);
    expect(out[12]).toBe(100);
  });
});

describe("percentilePass — 가는 획 제거", () => {
  it("높은 분위는 어두운 획을 배경 밝기로 덮는다", () => {
    const w = 21, h = 1;
    const src = new Uint8Array(w).fill(230);
    src[10] = 20;
    const out = percentilePass(src, w, h, 9, 0.95, false);
    expect(out[10]).toBeGreaterThan(200);
  });
});

describe("stripForeign — 배경이 아닌 것만 걷어낸다", () => {
  it("사진의 명암은 남기고 다른 물체만 대표색으로 되돌린다", () => {
    const ref: [number, number, number] = [235, 230, 225];
    const series = [
      [240, 236, 230], // 사진의 밝은 부분 — 남는다
      [250, 220, 120], // 노란 화살표 — 걷어낸다
      [228, 222, 218], // 사진의 어두운 부분 — 남는다
    ];
    expect(stripForeign(series, ref)).toEqual([[240, 236, 230], ref, [228, 222, 218]]);
  });

  it("backgroundRef 는 물체가 섞여도 다수인 배경색을 집는다", () => {
    const bg = Array.from({ length: 8 }, () => [235, 230, 225]);
    expect(backgroundRef([bg, [[10, 10, 10], [20, 20, 20]], null, null])).toEqual([235, 230, 225]);
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

describe("median / cleanEdge — 테두리에 걸친 글자 배제", () => {
  it("표본 일부가 글자여도 중앙값은 배경색을 집는다", () => {
    // 배경 240 이 다수, 글자 20 이 소수
    expect(median([240, 241, 239, 20, 240])).toBe(240);
  });

  it("짝수 개는 가운데 둘의 평균", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBe(0);
  });

  it("이웃과 크게 어긋나는 값(글자 획)을 이웃 중앙값으로 바꾼다", () => {
    // 예전에는 이 값이 그대로 보간에 쓰여 박스 전체로 줄무늬가 늘어났다
    const raw = [240, 240, 240, 20, 240, 240, 240];
    expect(cleanEdge(raw)).toEqual([240, 240, 240, 240, 240, 240, 240]);
  });

  it("완만한 그라데이션은 손대지 않는다", () => {
    const raw = [200, 205, 210, 215, 220, 225, 230];
    expect(cleanEdge(raw)).toEqual(raw);
  });
});

describe("groupBySize / unifySizes — 글자 크기 통일", () => {
  it("원문 높이가 비슷하면 한 묶음으로 본다", () => {
    // 12px 짜리 세 줄 + 24px 제목 → 두 묶음
    expect(groupBySize([12, 12.5, 13, 24])).toEqual([0, 0, 0, 1]);
  });

  it("높이가 계단식으로 벌어지면 각각 다른 묶음", () => {
    expect(groupBySize([10, 20, 40])).toEqual([0, 1, 2]);
  });

  it("같은 묶음은 가장 작은 크기로 통일한다 (다 들어가야 하므로)", () => {
    // 실사용 지적: 원문 12px 한 줄이 15·13·17px 로 제각각 나왔다
    expect(unifySizes([0, 0, 0], [15, 13, 17])).toEqual([13, 13, 13]);
  });

  it("번역문이 유난히 길어 혼자 많이 줄어야 하면 묶음에서 뺀다", () => {
    // 5 는 median(15) 의 75% 미만 → 혼자 제 크기를 쓰고 나머지는 통일
    expect(unifySizes([0, 0, 0], [15, 16, 5])).toEqual([15, 15, 5]);
  });

  it("묶음에 하나뿐이면 그대로 둔다", () => {
    expect(unifySizes([0, 1], [12, 30])).toEqual([12, 30]);
  });
});

describe("mustOverlay — 이미지 모델에 맡길 수 없는 경우", () => {
  const box = (over: Partial<OcrBox> = {}): OcrBox => ({
    box: [10, 10, 60, 300],
    zh: "快速伸缩",
    ko: "고속 신축",
    bg: "#ffffff",
    fg: "#000000",
    bold: true,
    solid_bg: false,
    ...over,
  });

  it("보통 번역 항목은 모델에 맡긴다", () => {
    expect(mustOverlay([box()])).toBe(false);
  });

  it("어드민이 위치·크기·굵기를 손댔으면 오버레이 (모델이 못 지킨다)", () => {
    expect(mustOverlay([box(), box({ dy: 6 })])).toBe(true);
    expect(mustOverlay([box({ scale: 1.2 })])).toBe(true);
  });

  it("지움으로 표시한 항목이 있으면 오버레이", () => {
    expect(mustOverlay([box({ mode: "erase" })])).toBe(true);
  });

  it("바꿀 문구가 없으면 오버레이", () => {
    expect(mustOverlay([box({ ko: "  " })])).toBe(true);
    expect(mustOverlay([box({ mode: "keep" })])).toBe(true);
    expect(mustOverlay([])).toBe(true);
  });
});

describe("eraseTargets — 원본에서 없어져야 하는 항목", () => {
  const box = (over: Partial<OcrBox> = {}): OcrBox => ({
    box: [10, 10, 60, 300],
    zh: "快速伸缩",
    ko: "고속 신축",
    bg: "#ffffff",
    fg: "#000000",
    bold: true,
    solid_bg: false,
    ...over,
  });

  it("번역할 것과 지울 것만 고른다 — 유지·빈 문구는 남긴다", () => {
    const keep = box({ mode: "keep" });
    const empty = box({ ko: " " });
    const erase = box({ mode: "erase" });
    const normal = box();
    expect(eraseTargets([keep, empty, erase, normal])).toEqual([erase, normal]);
  });
});

describe("regionIsStatic — GIF 글자 자리가 움직이는지", () => {
  const W = 20;
  const H = 20;
  const frame = (fill: number) => {
    const f = new Uint8Array(W * H * 4);
    for (let i = 0; i < f.length; i += 4) {
      f[i] = f[i + 1] = f[i + 2] = fill;
      f[i + 3] = 255;
    }
    return f;
  };

  it("모든 프레임이 같으면 정지", () => {
    expect(regionIsStatic([frame(100), frame(100), frame(100)], W, { x0: 2, y0: 2, x1: 18, y1: 18 })).toBe(true);
  });

  it("팔레트 노이즈 수준의 미세한 차이는 정지로 본다", () => {
    expect(regionIsStatic([frame(100), frame(110)], W, { x0: 2, y0: 2, x1: 18, y1: 18 })).toBe(true);
  });

  it("영역 안이 실제로 움직이면 정지가 아니다", () => {
    const a = frame(100);
    const b = frame(100);
    // 영역 안 절반이 크게 달라진다 (움직이는 제품이 지나감)
    for (let y = 5; y < 15; y++)
      for (let x = 5; x < 15; x++) {
        const i = (y * W + x) * 4;
        b[i] = b[i + 1] = b[i + 2] = 220;
      }
    expect(regionIsStatic([a, b], W, { x0: 2, y0: 2, x1: 18, y1: 18 })).toBe(false);
  });

  it("영역 밖의 움직임은 상관없다", () => {
    const a = frame(100);
    const b = frame(100);
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        b[i] = 250;
      }
    expect(regionIsStatic([a, b], W, { x0: 2, y0: 4, x1: 18, y1: 18 })).toBe(true);
  });
});

describe("inventedInBox — 모델 지우기가 도장을 지어냈는지", () => {
  const W = 40;
  const H = 40;
  const img = (fill: number) => {
    const d = new Uint8Array(W * H * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = fill;
      d[i + 3] = 255;
    }
    return d;
  };
  const box = { x0: 5, y0: 5, x1: 35, y1: 35 };

  it("획만 지웠으면(변한 픽셀이 획 언저리뿐) 통과", () => {
    const orig = img(240);
    // 원본: 박스 안에 가는 획 두 줄
    for (const yy of [12, 20])
      for (let x = 8; x < 32; x++) {
        const i = (yy * W + x) * 4;
        orig[i] = orig[i + 1] = orig[i + 2] = 20;
      }
    const clean = img(240); // 획이 배경색으로 돌아감
    expect(inventedInBox(orig, clean, W, box)).toBe(false);
  });

  it("박스 대부분이 달라졌으면(도장을 지어냄) 잡아낸다", () => {
    const orig = img(240);
    const clean = img(240);
    // 실사례: 지운 자리에 빨간 도장 — 박스 전체가 빨갛게 바뀜
    for (let y = box.y0; y < box.y1; y++)
      for (let x = box.x0; x < box.x1; x++) {
        const i = (y * W + x) * 4;
        clean[i] = 200;
        clean[i + 1] = 30;
        clean[i + 2] = 30;
      }
    expect(inventedInBox(orig, clean, W, box)).toBe(true);
  });

  it("재생성 노이즈 수준의 미세한 차이는 지어낸 게 아니다", () => {
    expect(inventedInBox(img(240), img(225), W, box)).toBe(false);
  });
});

describe("textBands — 글자 띠 자르기 (안전 필터 우회)", () => {
  const b = (ymin: number, ymax: number): OcrBox => ({
    box: [ymin, 50, ymax, 950],
    zh: "字",
    ko: "글",
    bg: "#ffffff",
    fg: "#000000",
    bold: false,
    solid_bg: true,
  });

  it("세로로 가까운 문구는 한 띠로 뭉친다", () => {
    // 1000x2000: 위쪽에 두 줄(픽셀 y 80~120, 160~200), 아래쪽에 한 줄(y 1800~1900)
    const bands = textBands([b(40, 60), b(80, 100), b(900, 950)], 1000, 2000);
    expect(bands).toHaveLength(2);
    expect(bands[0].boxes).toHaveLength(2);
    expect(bands[1].boxes).toHaveLength(1);
  });

  it("띠는 최소 높이(폭의 0.4배)를 보장한다 — 극단적 가로 비율은 모델이 못 그린다", () => {
    const bands = textBands([b(500, 510)], 1000, 2000);
    expect(bands[0].y1 - bands[0].y0).toBeGreaterThanOrEqual(400);
  });

  it("최소 높이로 넓히다 겹치면 다시 합친다", () => {
    // 두 문구가 200px 떨어짐 — 각자 400px 로 넓어지면 겹친다
    const bands = textBands([b(100, 110), b(200, 210)], 1000, 2000);
    expect(bands).toHaveLength(1);
    expect(bands[0].boxes).toHaveLength(2);
  });

  it("이미지 가장자리를 벗어나지 않는다", () => {
    const bands = textBands([b(0, 20), b(980, 1000)], 1000, 1000);
    for (const band of bands) {
      expect(band.y0).toBeGreaterThanOrEqual(0);
      expect(band.y1).toBeLessThanOrEqual(1000);
    }
  });

  it("문구가 없으면 빈 배열", () => {
    expect(textBands([], 1000, 1000)).toEqual([]);
  });
});

describe("textCoverage — 번역문이 잘렸는지", () => {
  it("그대로 찍혔으면 1", () => {
    expect(textCoverage("10단계 진동, 쉴 새 없는 파도처럼", "10단계 진동, 쉴 새 없는 파도처럼")).toBe(1);
  });

  it("공백·문장부호 차이는 무시한다 (모델이 흘리기 쉬운 부분)", () => {
    expect(textCoverage("비밀 배송/OEM", "비밀배송 OEM")).toBe(1);
  });

  it("잘린 문구를 잡아낸다 (실사례: 뒷말이 통째로 사라짐)", () => {
    // 원문 "前后10频震颤，一浪接一浪" → "10단계 진동, 쉴 새 없는 ㅈ" 로 잘려 그려졌다
    const c = textCoverage("10단계 진동, 쉴 새 없는 파도처럼", "10단계 진동, 쉴 새 없는 ㅈ");
    expect(c).toBeLessThan(0.8);
  });

  it("OCR 이 한두 글자 흘려도 통과시킨다 (오탐 방지)", () => {
    expect(textCoverage("스마트 온열 기능", "스마트 온열 기능")).toBe(1);
    expect(textCoverage("스마트 온열 기능", "스마트 온얼 기능")).toBeGreaterThan(0.8);
  });

  it("딴 말이 찍혔으면 낮게 나온다", () => {
    expect(textCoverage("고속 신축", "제품 정보")).toBeLessThan(0.8);
  });

  it("기대 문구가 비면 1, 읽힌 글자가 없으면 0", () => {
    expect(textCoverage("", "아무거나")).toBe(1);
    expect(textCoverage("고속 신축", "")).toBe(0);
  });
});

describe("truncatedTail — 뒤가 잘린 문구", () => {
  it("비율로는 통과하던 짧은 잘림을 잡는다 (실측: 0.83 으로 새어나감)", () => {
    const ko = "앞뒤 10단계 진동, 쉼 없는 자극";
    const seen = "앞뒤 10단계 진동, 쉼 없는";
    expect(textCoverage(ko, seen)).toBeGreaterThan(0.8); // 비율 검사는 놓친다
    expect(truncatedTail(ko, seen)).toBe(true); // 잘림 검사가 잡는다
  });

  it("끝 글자 하나는 OCR 오차로 보고 넘긴다", () => {
    expect(truncatedTail("고속 신축 기능", "고속 신축 기")).toBe(false);
  });

  it("다 찍혔으면 잘림이 아니다", () => {
    expect(truncatedTail("고속 신축", "고속 신축")).toBe(false);
    expect(truncatedTail("고속 신축", "고속 신축 기능")).toBe(false);
  });

  it("앞부분이 다르면 잘림이 아니다 (딴 말은 비율 검사 몫)", () => {
    expect(truncatedTail("고속 신축 기능", "저속 신축")).toBe(false);
  });

  it("아무것도 못 읽었으면 잘림으로 보지 않는다 (오탐 방지)", () => {
    expect(truncatedTail("고속 신축", "")).toBe(false);
  });
});

describe("mergeOverlappingBoxes — 포개져 그려지는 문구 병합", () => {
  const b = (box: [number, number, number, number], over: Partial<OcrBox> = {}): OcrBox => ({
    box,
    zh: "字",
    ko: "글",
    bg: "#ffffff",
    fg: "#000000",
    bold: false,
    solid_bg: true,
    ...over,
  });

  it("크게 겹치는 두 박스를 읽는 순서로 합친다 (실사례: GIF 부제 겹침)", () => {
    const r = mergeOverlappingBoxes(
      [b([100, 100, 160, 900], { ko: "매 순간의 열정을" }), b([120, 100, 180, 900], { ko: "선사하는 쾌감" })],
      1000,
      1000,
    );
    expect(r).toHaveLength(1);
    expect(r[0].ko).toBe("매 순간의 열정을 선사하는 쾌감");
    expect(r[0].box).toEqual([100, 100, 180, 900]);
  });

  it("떨어져 있는 박스는 건드리지 않는다", () => {
    const r = mergeOverlappingBoxes([b([100, 100, 160, 900]), b([300, 100, 360, 900])], 1000, 1000);
    expect(r).toHaveLength(2);
  });

  it("수동 조정한 박스는 합치지 않는다 (운영자가 자리를 정했다)", () => {
    const r = mergeOverlappingBoxes(
      [b([100, 100, 160, 900]), b([120, 100, 180, 900], { dy: 5 })],
      1000,
      1000,
    );
    expect(r).toHaveLength(2);
  });

  it("세로로 겹쳐도 색이 다르면 합치지 않는다 (빨간 제목 + 검정 부제)", () => {
    const r = mergeOverlappingBoxes(
      [b([100, 100, 160, 900], { fg: "#cc0000" }), b([155, 100, 210, 900])],
      1000,
      1000,
    );
    expect(r).toHaveLength(2);
  });

  it("가로로 어긋난 박스는 합치지 않는다 (옆에 놓인 다른 항목)", () => {
    const r = mergeOverlappingBoxes(
      [b([100, 100, 160, 400]), b([150, 500, 210, 900])],
      1000,
      1000,
    );
    expect(r).toHaveLength(2);
  });

  it("병합 결과는 줄 구조를 남긴다 — 두 줄이 한 줄로 뭉개지지 않게", () => {
    const r = mergeOverlappingBoxes(
      [b([100, 100, 160, 900], { ko: "첫 줄" }), b([155, 100, 210, 900], { ko: "둘째 줄" })],
      1000,
      1000,
    );
    expect(r[0].lines).toEqual(["첫 줄", "둘째 줄"]);
  });
});

describe("splitTwoLines — 긴 문구 두 줄 나누기", () => {
  it("가운데에서 가장 가까운 공백에서 나눈다", () => {
    expect(splitTwoLines("매 순간의 열정을 선사하는 쾌감")).toEqual(["매 순간의 열정을", "선사하는 쾌감"]);
  });

  it("공백이 없으면 null (한 줄 유지)", () => {
    expect(splitTwoLines("고속신축진동")).toBeNull();
  });

  it("한쪽이 너무 짧아지면 null", () => {
    expect(splitTwoLines("아 진동바이브레이터")).toBeNull();
  });
});

describe("charBudget tight — GIF 띠 전용(폭을 넓힐 수 없다)", () => {
  // 실측(2026-09-02): 기본 예산은 글자가 박스 높이의 절반까지 작아지는 것을
  // 허용해, 「多种频率」(4자)→「다양한 진동 모드」(8자) 띠에서 글자가 61%로 줄었다.
  // 실측 M19 「多种频率」 자리: 750x534 이미지에서 폭 113px · 글자높이 28px
  const box4 = [400, 100, 428, 213] as [number, number, number, number];

  it("기본보다 짧게 잡는다 — 원본 글자 크기를 지키는 선", () => {
    const loose = charBudget(box4, 1000, 1000, 4);
    const tight = charBudget(box4, 1000, 1000, 4, true);
    expect(tight).toBeLessThan(loose);
  });

  it("'다양한 진동 모드'(8자)는 넘고 '다양한 진동'(6자)은 들어간다", () => {
    const b = charBudget(box4, 1000, 1000, 4, true);
    expect(b).toBeLessThan(8);
    expect(b).toBeGreaterThanOrEqual(6);
  });

  it("뜻을 깎을 만큼 조이지는 않는다 — 실측: ×1.2 로 조였더니 부위 이름이 빠졌다", () => {
    // 「入体进阶」(4자) 자리에 "인체공학 설계"(공백 제외 6자) 는 들어가야 한다
    const title = [100, 60, 190, 500] as [number, number, number, number];
    expect(charBudget(title, 750, 703, 4, true)).toBeGreaterThanOrEqual(6);
  });

  it("정지 이미지(기본값)는 그대로 — 이미지 번역 경로는 건드리지 않는다", () => {
    expect(charBudget(box4, 1000, 1000, 4)).toBe(charBudget(box4, 1000, 1000, 4, false));
  });
});

describe("charBudget — 자리에 들어갈 글자 수", () => {
  // 1000x1000 이미지에서 폭 400px·높이 40px 박스 → 수용량 10자
  const wide: [number, number, number, number] = [100, 100, 140, 500];

  it("원문 대비 1.6배와 박스 수용량 중 큰 쪽을 준다", () => {
    // zh 4자 → 6.4 → 7 / 수용량 10×2.2 = 22 → 넓은 박스라 22
    expect(charBudget(wide, 1000, 1000, 4)).toBe(22);
    // zh 20자 → 32 / 수용량 22 → 원문이 기니 32
    expect(charBudget(wide, 1000, 1000, 20)).toBe(32);
  });

  it("세로쓰기는 폭÷높이가 수용량이 아니므로 원문 기준만 본다", () => {
    const vert: [number, number, number, number] = [100, 100, 500, 140];
    expect(charBudget(vert, 1000, 1000, 5)).toBe(8); // 5×1.6
  });

  it("아주 짧은 문구도 최소 6자는 준다 (한 글자로 옮길 수 없는 말이 있다)", () => {
    const tiny: [number, number, number, number] = [100, 100, 120, 130];
    expect(charBudget(tiny, 1000, 1000, 1)).toBe(6);
  });

  it("실측 분포의 90%는 예산 안에 든다 (지킬 수 있는 규칙이어야 한다)", () => {
    // 중앙값 1.31배, 95퍼센타일 2.25배 → 1.6배 기준은 대다수를 통과시킨다
    expect(charBudget(wide, 1000, 1000, 10)).toBeGreaterThanOrEqual(16);
  });
});

describe("brokenWordTail — 어절 중간에서 한 글자 잘림", () => {
  it("어절 중간에서 잘리면 한 글자 차이라도 잡는다 (운영 신고 사례)", () => {
    // truncatedTail 은 OCR 오차 여유로 2글자부터 봐서 이걸 놓쳤다
    expect(brokenWordTail("짧게 눌러 헤드 모드 변경", "짧게 눌러 헤드 모드 변")).toBe(true);
  });

  it("통짜 어절 누락은 여기서 안 잡는다 — truncatedTail(2글자) 몫", () => {
    expect(brokenWordTail("앞뒤 10단계 진동 자극", "앞뒤 10단계 진동")).toBe(false);
  });

  it("끝의 문장부호만 빠진 건 잘림이 아니다", () => {
    expect(brokenWordTail("강력한 파워!", "강력한 파워")).toBe(false);
  });

  it("완전히 같으면 잘림이 아니다", () => {
    expect(brokenWordTail("원터치 부스터", "원터치 부스터")).toBe(false);
  });

  it("앞부분이 다르면 잘림 판정을 하지 않는다 (다른 문구가 찍힌 것)", () => {
    expect(brokenWordTail("원터치 부스터", "완전히 다른말")).toBe(false);
  });
});

describe("blankedBox — 지워진 채 방치된 자리", () => {
  const W = 100;
  const H = 100;
  /** 단색 캔버스에 세로 줄무늬(글자 획 흉내)를 넣은 RGBA raw */
  const canvasRaw = (bg: number, stripes: boolean): Uint8Array => {
    const raw = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = stripes && x % 8 < 3 && y > 20 && y < 80 ? 10 : bg;
        raw[i] = raw[i + 1] = raw[i + 2] = v;
        raw[i + 3] = 255;
      }
    }
    return raw;
  };
  const box: [number, number, number, number] = [200, 100, 800, 900];

  it("원본에 획이 있었는데 결과가 민 배경이면 빈 자리다 (흰 뭉개짐 사고)", () => {
    expect(blankedBox(canvasRaw(230, true), canvasRaw(230, false), W, H, box)).toBe(true);
  });

  it("결과에 획 대비가 남아 있으면(그렸는데 OCR이 못 읽은 것) 건드리지 않는다", () => {
    expect(blankedBox(canvasRaw(230, true), canvasRaw(230, true), W, H, box)).toBe(false);
  });

  it("원본부터 민 배경이었으면 빈 자리 판정을 하지 않는다", () => {
    expect(blankedBox(canvasRaw(230, false), canvasRaw(230, false), W, H, box)).toBe(false);
  });
});

describe("seamGap — 패치 경계가 보일지", () => {
  const W = 60;
  const H = 60;
  const grad = (shift: number): Uint8Array => {
    const raw = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = Math.min(255, x * 4 + shift); // 가로 그라데이션
        raw[i] = raw[i + 1] = raw[i + 2] = v;
        raw[i + 3] = 255;
      }
    }
    return raw;
  };
  const rect = { x0: 10, y0: 10, x1: 50, y1: 50 };

  it("배경을 그대로 살린 패치는 테두리 차이가 바닥 노이즈 수준이다", () => {
    expect(seamGap(grad(0), grad(0), W, H, rect)).toBe(0);
    expect(seamGap(grad(0), grad(4), W, H, rect)).toBeLessThan(8);
  });

  it("배경을 다시 그린 패치는 테두리 차이가 크다 — 얹으면 네모가 보인다", () => {
    expect(seamGap(grad(0), grad(40), W, H, rect)).toBeGreaterThan(14);
  });
});

describe("contrastStroke — 글자색이 배경에 묻힐 때 외곽선", () => {
  it("흰 글씨가 밝은 배경에 오면 어두운 외곽선 (흰 글씨 사고)", () => {
    expect(contrastStroke("#ffffff", [240, 240, 240])).toBe("#222222");
  });

  it("어두운 글씨가 어두운 배경에 오면 밝은 외곽선", () => {
    expect(contrastStroke("#111111", [40, 40, 40])).toBe("#ffffff");
  });

  it("대비가 충분하면 외곽선을 두르지 않는다 — 디자인 유지", () => {
    expect(contrastStroke("#ffffff", [30, 30, 30])).toBeNull();
    expect(contrastStroke("#e60023", [255, 255, 255])).toBeNull(); // 흰 바탕 빨간 글씨
  });

  it("3자리 축약 hex 도 읽는다", () => {
    expect(contrastStroke("#fff", [250, 250, 250])).toBe("#222222");
  });
});

describe("parseJsonArrayLoose — 잘린 검수 응답 구제", () => {
  it("온전한 배열은 그대로 파싱한다", () => {
    expect(parseJsonArrayLoose('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("토큰 한도로 뒤가 잘린 배열에서 온전한 원소만 건진다 (실측: 문구 37개 이미지)", () => {
    const cut = '[{"box":[1,2,3,4],"text":"가"},{"box":[5,6,7,8],"text":"나"},{"box":[9,10';
    expect(parseJsonArrayLoose(cut)).toEqual([
      { box: [1, 2, 3, 4], text: "가" },
      { box: [5, 6, 7, 8], text: "나" },
    ]);
  });

  it("닫혔지만 중간 원소가 깨진 배열도 원소 단위로 건진다", () => {
    const broken = '[{"text":"가"},{"text":"나"제},{"text":"다"}]';
    expect(parseJsonArrayLoose(broken)).toEqual([{ text: "가" }, { text: "다" }]);
  });

  it("빈 배열은 빈 배열 — 글자 없음 판정의 근거", () => {
    expect(parseJsonArrayLoose("[]")).toEqual([]);
  });

  it("JSON 이 아예 없으면 null — 거부·빈 응답을 글자 없음과 구분한다", () => {
    expect(parseJsonArrayLoose("이미지를 처리할 수 없습니다")).toBeNull();
    expect(parseJsonArrayLoose("")).toBeNull();
  });
});

describe("choppedGlyphTail — 낱자로 끝난 잘림", () => {
  it("어절이 획 중간에서 잘려 낱자로 읽히면 잡는다 (운영 스크린샷: 전신 부드러ㄷ)", () => {
    expect(choppedGlyphTail("전신 부드러운 감촉", "전신 부드러ㄷ")).toBe(true);
  });

  it("정상 문구는 잡지 않는다", () => {
    expect(choppedGlyphTail("전신 부드러운 감촉", "전신 부드러운 감촉")).toBe(false);
  });

  it("기대 문구 자체가 낱자로 끝나면 잘림이 아니다", () => {
    expect(choppedGlyphTail("이중 자극 굿ㅋㅋ", "이중 자극 굿ㅋㅋ")).toBe(false);
  });

  it("기대 문구 중간에서 낱자로 끊겨 읽힌 것도 잡는다 (truncatedTail 과 겹쳐도 무해)", () => {
    expect(choppedGlyphTail("진동 세기 5단 조절", "진동 세기 5ㄷ")).toBe(true);
  });

  it("아무것도 못 읽었으면 판정하지 않는다", () => {
    expect(choppedGlyphTail("전신 부드러운", "")).toBe(false);
  });
});

describe("잘림 검사 — 물결·말줄임 마감 (실측: 깊은 진~)", () => {
  it("잘린 끝의 ~ 는 비교에서 빠져 prefix 잘림으로 잡힌다", () => {
    // ~ 를 안 빼면 "깊은 진~"이 "깊은 진동"의 앞부분으로 인정되지 않았다
    expect(brokenWordTail("강렬한 깊은 진동", "강렬한 깊은 진~")).toBe(true);
  });

  it("기대 문구에 있는 … 도 똑같이 빠져 오탐하지 않는다", () => {
    expect(truncatedTail("강렬한 자극…", "강렬한 자극")).toBe(false);
  });
});

describe("remapBandBox — OCR 띠 좌표 복원", () => {
  it("띠 안 좌표를 전체 이미지 기준으로 되돌린다", () => {
    // 30% 지점부터 높이 45% 띠에서 [0,100,1000,900] → 전체의 [300,100,750,900]
    expect(remapBandBox([0, 100, 1000, 900], 0.3, 0.45)).toEqual([300, 100, 750, 900]);
  });

  it("첫 띠(시작 0)는 ymin 이 그대로다", () => {
    expect(remapBandBox([200, 0, 400, 1000], 0, 0.45)).toEqual([90, 0, 180, 1000]);
  });

  it("복원 좌표는 1000 을 넘지 않는다", () => {
    expect(remapBandBox([1000, 0, 1000, 1000], 0.55, 0.45)[2]).toBe(1000);
  });
});

describe("dedupeBandBoxes — 겹친 띠의 중복 문구 제거", () => {
  const mk = (zh: string, box: [number, number, number, number]): OcrBox => ({
    box,
    zh,
    ko: zh,
    bg: "#ffffff",
    fg: "#000000",
    bold: false,
    solid_bg: true,
  });

  it("같은 원문이 세로로 겹치면 하나만 남긴다 — 큰 박스(온전히 들어온 띠) 우선", () => {
    const half = mk("产品信息", [300, 100, 340, 500]);
    const full = mk("产品信息", [295, 100, 345, 900]);
    const out = dedupeBandBoxes([half, full]);
    expect(out).toHaveLength(1);
    expect(out[0].box).toEqual(full.box);
  });

  it("같은 원문이라도 위치가 다르면(반복 문구) 둘 다 남긴다", () => {
    const a = mk("包装升级", [100, 0, 140, 500]);
    const b = mk("包装升级", [800, 0, 840, 500]);
    expect(dedupeBandBoxes([a, b])).toHaveLength(2);
  });

  it("다른 원문은 겹쳐도 남긴다 (제목과 부제)", () => {
    const a = mk("产品信息", [100, 0, 160, 500]);
    const b = mk("随机发货", [140, 0, 200, 500]);
    expect(dedupeBandBoxes([a, b])).toHaveLength(2);
  });
});

describe("ghostResidue — 지운 자리 내부 잔상", () => {
  const W = 200;
  const H = 120;
  const box = { x0: 40, y0: 30, x1: 160, y1: 90 };
  /** 전체를 val 로 채운 RGBA */
  const flat = (val: number) => {
    const d = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = val;
      d[i * 4 + 3] = 255;
    }
    return d;
  };
  /** 박스 내부에만 줄무늬 잔상을 남긴 그림 (반쯤 지워진 획) */
  const ghosted = () => {
    const d = flat(200);
    for (let y = box.y0 + 12; y < box.y1 - 12; y += 8) {
      for (let yy = y; yy < y + 3; yy++) {
        for (let x = box.x0 + 15; x < box.x1 - 15; x++) {
          const i = (yy * W + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = 150;
        }
      }
    }
    return d;
  };
  /** 안팎이 똑같이 거친 질감 (실크·그라데이션) */
  const textured = () => {
    const d = flat(200);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = 200 + ((x + y) % 2 === 0 ? 20 : -20);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    return d;
  };

  it("깨끗이 지운 민 배경은 잔상이 없다", () => {
    expect(ghostResidue(flat(200), W, H, box)).toBeLessThan(1);
  });

  it("내부에만 남은 반투명 획은 주변 대비 몇 배로 튄다 (운영 신고: 빨간 제품 뭉개짐)", () => {
    expect(ghostResidue(ghosted(), W, H, box)).toBeGreaterThan(2);
  });

  it("실크처럼 안팎이 똑같이 거친 질감은 오탐하지 않는다", () => {
    expect(ghostResidue(textured(), W, H, box)).toBeLessThan(2);
  });

  it("링에 물린 이웃 박스는 제외하고 잰다 — 이웃 글자가 잔상으로 오염되지 않게", () => {
    const d = flat(200);
    // 이웃 박스(오른쪽)에 진한 글자 — 제외 안 하면 링 편차가 부풀어 잔상이 가려진다
    const nb = { x0: 165, y0: 30, x1: 195, y1: 90 };
    for (let y = nb.y0; y < nb.y1; y++)
      for (let x = nb.x0; x < nb.x1; x++) {
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 20;
      }
    const withEx = ghostResidue(d, W, H, box, [nb]);
    const without = ghostResidue(d, W, H, box);
    expect(withEx).toBeLessThanOrEqual(without);
  });

  it("판정 불가(너무 작은 박스)는 0 — 잔상 아님으로 통과", () => {
    expect(ghostResidue(flat(200), W, H, { x0: 0, y0: 0, x1: 8, y1: 8 })).toBe(0);
  });
});

describe("edgeCrossing — 글자가 패치 경계를 삐져나감", () => {
  const W = 200;
  const H = 200;
  const rect = { x0: 40, y0: 40, x1: 160, y1: 160 };
  const flat = (val: number) => {
    const d = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = val;
      d[i * 4 + 3] = 255;
    }
    return d;
  };

  it("경계가 조용하면 0 근처다", () => {
    expect(edgeCrossing(flat(200), flat(200), W, H, rect)).toBeLessThan(10);
  });

  it("오른쪽 경계 일부만 넘은 글자 꼬리를 잡는다 (실측: '자극' 이 반투명하게 잘림)", () => {
    const regen = flat(200);
    // 글자 획이 오른쪽 경계(160) 바로 밖 4px 밴드에 걸침 — 세로 30px 구간만
    for (let y = 90; y < 120; y++) {
      for (let x = 160; x < 164; x++) {
        const i = (y * W + x) * 4;
        regen[i] = regen[i + 1] = regen[i + 2] = 20;
      }
    }
    // 전체 둘레 평균(seamGap 방식)이라면 4변에 희석돼 낮게 나온다 —
    // 조각별 최댓값은 그 구간에서 확 뛴다
    expect(edgeCrossing(flat(200), regen, W, H, rect)).toBeGreaterThan(45);
  });

  it("경계 안쪽의 변화(정상 재생성 글자)는 잡지 않는다", () => {
    const regen = flat(200);
    for (let y = 90; y < 120; y++) {
      for (let x = 60, e = 140; x < e; x++) {
        const i = (y * W + x) * 4;
        regen[i] = regen[i + 1] = regen[i + 2] = 20;
      }
    }
    expect(edgeCrossing(flat(200), regen, W, H, rect)).toBeLessThan(10);
  });
});

describe("edgeCrossing — 드리프트와 침범의 구분", () => {
  const W = 200;
  const H = 200;
  const rect = { x0: 40, y0: 40, x1: 160, y1: 160 };
  const checker = (shift: number) => {
    const d = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = (x + shift + y) % 4 < 2 ? 230 : 170; // 반짝이 질감
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    return d;
  };

  it("질감이 1px 밀린 드리프트는 차이가 커도 침범이 아니다 (실측: 16/17 오탐)", () => {
    // 같은 질감의 이동 — 픽셀 차이는 크지만 조각의 거칠기는 그대로다
    expect(edgeCrossing(checker(0), checker(1), W, H, rect)).toBeLessThan(45);
  });
});

describe("워터마크 자동 지움 (wm)", () => {
  const wmBox: OcrBox = {
    box: [100, 100, 140, 900],
    zh: "东莞市带劲科技有限公司",
    ko: "",
    bg: "#ffffff",
    fg: "#cccccc",
    bold: false,
    solid_bg: false,
    wm: true,
    mode: "erase",
  };
  const tBox: OcrBox = {
    box: [200, 100, 300, 900],
    zh: "舌尖撩拨",
    ko: "짜릿한 자극",
    bg: "#ffffff",
    fg: "#000000",
    bold: true,
    solid_bg: true,
  };

  it("parseOcrBoxes 가 wm 플래그를 보존한다", () => {
    const r = parseOcrBoxes([{ ...wmBox }]);
    expect(r).toHaveLength(1);
    expect(r[0].wm).toBe(true);
    expect(r[0].mode).toBe("erase");
  });

  it("wm 지움은 수동 조정이 아니다 — 오버레이 강제 사유가 안 된다", () => {
    expect(hasManualOverride(wmBox)).toBe(false);
    expect(mustOverlay([wmBox, tBox])).toBe(false); // 기본 재생성 경로 유지
  });

  it("어드민이 직접 지운 박스는 여전히 오버레이 경로다", () => {
    const adminErase: OcrBox = { ...tBox, mode: "erase" };
    expect(hasManualOverride(adminErase)).toBe(true);
    expect(mustOverlay([adminErase, tBox])).toBe(true);
  });

  it("워터마크만 있는 이미지는 지우기 경로로 간다", () => {
    // 번역할 문구가 없으므로 mustOverlay(=eraseThenDraw) — 지우기만 하고 끝
    expect(mustOverlay([wmBox])).toBe(true);
  });

  it("wm 박스는 지움 대상 목록에 들어간다", () => {
    expect(eraseTargets([wmBox, tBox])).toHaveLength(2);
  });
});

describe("dropRiskyWm — 다른 글자와 겹치는 워터마크 제외", () => {
  const wm = (box: [number, number, number, number]): OcrBox => ({
    box,
    zh: "东莞市带劲科技有限公司",
    ko: "",
    bg: "#ffffff",
    fg: "#cccccc",
    bold: false,
    solid_bg: false,
    wm: true,
    mode: "erase",
  });
  const tx = (box: [number, number, number, number]): OcrBox => ({
    box,
    zh: "产品名称",
    ko: "제품명",
    bg: "#ffffff",
    fg: "#000000",
    bold: false,
    solid_bg: true,
  });

  it("표·문구를 가로지르는 워터마크는 지움 대상에서 뺀다 (실측 m5: 표 글자 훼손)", () => {
    const r = dropRiskyWm([wm([150, 50, 200, 950]), tx([140, 100, 220, 400])]);
    expect(r).toHaveLength(1);
    expect(r[0].wm).toBeUndefined();
  });

  it("떨어져 있는 워터마크는 지움 대상으로 남긴다", () => {
    const r = dropRiskyWm([wm([700, 50, 750, 950]), tx([100, 100, 180, 400])]);
    expect(r).toHaveLength(2);
  });

  it("워터마크끼리 겹치는 건 상관없다 (같이 지운다)", () => {
    const r = dropRiskyWm([wm([100, 50, 150, 950]), wm([140, 50, 190, 950])]);
    expect(r).toHaveLength(2);
  });
});

describe("clipRectAgainst — 이웃 박스 침범 잘라내기", () => {
  // 실측 e2e #7 기하 (H=1254): 제목 패치 하단(197)이 부제 코어 상단(189)을 8px 침범
  // → 보정 합성에서 첫 재생성의 탈락 글자 조각이 부제 위에 띠로 남았다(잔획)
  const feather = 10;

  it("아래 이웃을 침범한 패치 하단을 이웃 코어 앞에서 자른다 (실측 #7)", () => {
    const r = { x0: 0, y0: 1, x1: 900, y1: 197, feather };
    const core = { x0: 52, y0: 50, x1: 571, y1: 148 };
    const clipped = clipRectAgainst(r, core, [{ x0: 51, y0: 189, x1: 634, y1: 255 }]);
    expect(clipped.y1).toBe(189);
    expect(clipped).toMatchObject({ x0: 0, y0: 1, x1: 900 });
  });

  it("위 이웃 침범은 패치 상단을 자른다", () => {
    const r = { x0: 0, y0: 140, x1: 900, y1: 288, feather };
    const core = { x0: 51, y0: 189, x1: 634, y1: 255 };
    const clipped = clipRectAgainst(r, core, [{ x0: 52, y0: 50, x1: 571, y1: 148 }]);
    expect(clipped.y0).toBe(148);
  });

  it("옆 이웃 침범은 좌우만 자른다 (실측 #0: '직' 중복 — 가로 인접 박스)", () => {
    const r = { x0: 10, y0: 100, x1: 500, y1: 200, feather };
    const core = { x0: 100, y0: 120, x1: 400, y1: 180 };
    const clipped = clipRectAgainst(r, core, [
      { x0: 420, y0: 110, x1: 600, y1: 190 }, // 오른쪽 이웃
      { x0: 0, y0: 110, x1: 60, y1: 190 }, // 왼쪽 이웃
    ]);
    expect(clipped.x1).toBe(420);
    expect(clipped.x0).toBe(60);
    expect(clipped).toMatchObject({ y0: 100, y1: 200 });
  });

  it("안 겹치는 이웃은 건드리지 않는다", () => {
    const r = { x0: 0, y0: 1, x1: 900, y1: 197, feather };
    const core = { x0: 52, y0: 50, x1: 571, y1: 148 };
    const clipped = clipRectAgainst(r, core, [{ x0: 0, y0: 300, x1: 900, y1: 400 }]);
    expect(clipped).toMatchObject({ x0: 0, y0: 1, x1: 900, y1: 197 });
  });

  it("코어끼리 겹치면 가를 수 없다 — 그대로 둔다 (밀집 그리드 #14)", () => {
    const r = { x0: 0, y0: 90, x1: 500, y1: 210, feather };
    const core = { x0: 10, y0: 100, x1: 490, y1: 200 };
    const clipped = clipRectAgainst(r, core, [{ x0: 200, y0: 150, x1: 600, y1: 250 }]);
    expect(clipped).toMatchObject({ x0: 0, y0: 90, x1: 500, y1: 210 });
  });

  it("자기 코어는 절대 줄이지 않는다 — 잘라도 코어를 다 덮는다", () => {
    const r = { x0: 0, y0: 1, x1: 900, y1: 197, feather };
    const core = { x0: 52, y0: 50, x1: 571, y1: 148 };
    // 이웃 코어 상단이 자기 코어 하단과 같은 극단 케이스
    const clipped = clipRectAgainst(r, core, [{ x0: 51, y0: 148, x1: 634, y1: 255 }]);
    expect(clipped.y1).toBe(148); // 코어 하단까지는 유지
    expect(clipped.y0).toBeLessThanOrEqual(core.y0);
    expect(clipped.x0).toBeLessThanOrEqual(core.x0);
    expect(clipped.x1).toBeGreaterThanOrEqual(core.x1);
  });
});

describe("unchangedBox — 판독이 못 읽은 자리의 원문 잔류 픽셀 검출", () => {
  // 실측(2026-08-18): 잔류 박스 변화율 0.036~0.089, 정상 번역 0.48+, 깨끗한 바닥 ~0.16
  const W = 100;
  const H = 100;
  const box: [number, number, number, number] = [200, 100, 800, 900]; // y 20~80, x 10~90
  const flat = (v: number): Uint8Array => {
    const d = new Uint8Array(W * H * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    return d;
  };
  /** 박스 안 픽셀 일부를 어두운 획으로 (비율만큼) */
  const withStrokes = (base: Uint8Array, frac: number): Uint8Array => {
    const d = base.slice();
    const x0 = 10, x1 = 90, y0 = 20, y1 = 80;
    const total = (x1 - x0) * (y1 - y0);
    let put = 0;
    for (let y = y0; y < y1 && put < total * frac; y++) {
      for (let x = x0; x < x1 && put < total * frac; x++) {
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 20;
        put++;
      }
    }
    return d;
  };

  it("원본과 같은 픽셀(재생성 드리프트뿐)이면 잔류로 본다", () => {
    const orig = withStrokes(flat(240), 0.3);
    const drift = orig.map((v, i) => (i % 4 === 3 ? v : Math.min(255, v + 12))); // 약한 드리프트
    expect(unchangedBox(orig, new Uint8Array(drift), W, H, box)).toBe(true);
  });

  it("한국어를 새로 그렸으면(강한 변화 30%) 잔류가 아니다", () => {
    const orig = flat(240);
    const drawn = withStrokes(orig, 0.3);
    expect(unchangedBox(orig, drawn, W, H, box)).toBe(false);
  });

  it("변화가 임계(12%) 근처보다 적으면 잔류다 — 실측 잔류 최고치 0.089 대응", () => {
    const orig = flat(240);
    const barely = withStrokes(orig, 0.09);
    expect(unchangedBox(orig, barely, W, H, box)).toBe(true);
  });

  it("너무 작은 박스는 판정하지 않는다", () => {
    const orig = flat(240);
    expect(unchangedBox(orig, orig, W, H, [0, 0, 2, 2])).toBe(false);
  });
});

describe("clipRectAgainst — 실수 좌표 회귀 (실측 #9 패치 통째 유실)", () => {
  it("잘린 경계는 반드시 정수다 — 실수 시작점은 버퍼 인덱스를 전부 소수로 만든다", () => {
    // 실측 #9: line4 rect y0=326 이 이웃(line3, toPixelBox 실수 좌표) 하단
    // 330.552 로 잘리며 실수가 됐고, buildPatchOverlay 가 아무것도 못 그려
    // pasteBack 줄이 중국어 원문 그대로 나갔다.
    const r = { x0: 0, y0: 326, x1: 732, y1: 396, feather: 8.7 };
    const core = { x0: 42.96, y0: 343.728, x1: 594.28, y1: 378.672 };
    const clipped = clipRectAgainst(r, core, [
      { x0: 66.13, y0: 275.45, x1: 424.85, y1: 330.552 }, // 위 이웃 (실수 좌표)
    ]);
    expect(clipped.y0).toBe(331); // ceil(330.552)
    expect(Number.isInteger(clipped.x0)).toBe(true);
    expect(Number.isInteger(clipped.y0)).toBe(true);
    expect(Number.isInteger(clipped.x1)).toBe(true);
    expect(Number.isInteger(clipped.y1)).toBe(true);
    // 코어는 여전히 다 덮는다
    expect(clipped.y0).toBeLessThanOrEqual(Math.ceil(core.y0));
    expect(clipped.y1).toBeGreaterThanOrEqual(Math.floor(core.y1));
  });
});

describe("gateLeftover — 최종 관문 판정", () => {
  const line = (
    box: [number, number, number, number],
    zh: string,
    wm?: boolean,
  ): OcrBox => ({
    box,
    zh,
    ko: "",
    bg: "#ffffff",
    fg: "#000000",
    bold: false,
    solid_bg: true,
    ...(wm ? { wm: true } : {}),
  });

  it("번역했어야 할 자리에 남은 중국어를 센다 (실측 #9: 舒适体验升级 잔존)", () => {
    expect(gateLeftover([line([146, 80, 203, 569], "舒适体验升级")], [])).toBe(1);
  });

  /**
   * 실사례(2026-08-27 감사): "판독이 워터마크로 본 줄은 무조건 면책"이 지우라고
   * **시킨** 워터마크의 지우기 실패까지 통째로 덮었다. dropRiskyWm 이 "지움을
   * 포기한" 워터마크를 배열에서 아예 빼기 때문에, 남아 있는 wm 박스는 전부
   * 지우기 대상이다 — 그게 완성본에 그대로 읽히면 실패지 정상이 아니다.
   * 반만 지워진 워터마크(잔획)가 VERIFIED 로 나가던 유일한 경로였다.
   */
  it("지우라고 시킨 워터마크가 완성본에 남아 있으면 잔류로 센다", () => {
    expect(gateLeftover([line([100, 50, 150, 900], "东莞市带劲科技有限公司", true)], [])).toBe(1);
  });

  it("지움을 포기한 워터마크 자리와 겹치는 줄만 면책 (실측 #5·#6: 사진 겹침 유지)", () => {
    // 호출부가 "포기한 것"만 넘긴다 — 시킨 것과 포기한 것을 여기서 구분할 수 없다
    const gaveUp = { ...line([100, 50, 150, 900], "东莞市带劲科技有限公司"), wm: true };
    expect(gateLeftover([line([105, 60, 145, 880], "东莞市带劲科技有限公司")], [gaveUp])).toBe(0);
  });

  it("포기한 워터마크 자리와 겹치면 판독이 wm 으로 봤든 아니든 면책", () => {
    const gaveUp = { ...line([100, 50, 150, 900], "水印"), wm: true };
    expect(gateLeftover([line([105, 60, 145, 880], "水印", true)], [gaveUp])).toBe(0);
  });

  it("외국어가 아닌 줄(한글·영문)은 세지 않는다", () => {
    expect(
      gateLeftover(
        [line([100, 50, 150, 400], "USB 충전"), line([200, 50, 250, 400], "IPX7 WATERPROOF")],
        [],
      ),
    ).toBe(0);
  });

  it("워터마크 자리 밖의 중국어는 워터마크가 있어도 잡는다", () => {
    const keptWm = { ...line([100, 50, 150, 900], "水印"), wm: true, mode: "erase" as const };
    expect(gateLeftover([line([700, 50, 750, 400], "售后无忧")], [keptWm])).toBe(1);
  });
});



/**
 * pickTranslated — "번역 실패"와 "바꿀 게 없어서 그대로"를 가른다.
 *
 * 이 구분이 없어서 실사례(2026-08-27 감사)가 났다: 에코·빈 번역이 조용히
 * 버려지고 전량 버려지면 NO_FOREIGN_TEXT(노출 허용)가 됐다. 반대로 과잉
 * 차단도 위험하다 — USB·단위·브랜드처럼 원래 안 바뀌는 문구까지 실패로
 * 치면 멀쩡한 이미지가 전부 검수 대기로 쏟아져 운영이 마비된다.
 */
describe("pickTranslated — 번역 실패만 잡고 정상 무변경은 통과시킨다", () => {
  const b = (zh: string) => ({
    box: [100, 100, 200, 900] as [number, number, number, number],
    zh,
    ko: "",
    bg: "#fff",
    fg: "#000",
  });

  it("정상 번역은 채택되고 실패 목록은 비어 있다", () => {
    const r = pickTranslated([b("强震深处")], ["강렬한 진동"]);
    expect(r.boxes).toHaveLength(1);
    expect(r.boxes[0].ko).toBe("강렬한 진동");
    expect(r.untranslated).toEqual([]);
  });

  it("중국어 에코는 번역 실패로 잡는다", () => {
    const r = pickTranslated([b("强震深处")], ["强震深处"]);
    expect(r.boxes).toHaveLength(0);
    expect(r.untranslated).toEqual(["强震深处"]);
  });

  it("가나 전용 일본어 에코도 잡는다 — 한자 보정이 안 돌아 여기까지 온다", () => {
    const r = pickTranslated([b("ぬるぬる")], ["ぬるぬる"]);
    expect(r.untranslated).toEqual(["ぬるぬる"]);
  });

  it("외국어인데 번역이 비면 실패로 잡는다", () => {
    expect(pickTranslated([b("防水设计")], [""]).untranslated).toEqual(["防水设计"]);
    expect(pickTranslated([b("防水设计")], [undefined as unknown as string]).untranslated).toEqual(["防水设计"]);
  });

  /* ── 대조군: 원래 안 바뀌는 문구는 실패가 아니다 ── */
  it.each([
    ["영문 규격", "USB"],
    ["브랜드명", "LUVY"],
    ["한국어(이미 번역됨)", "루비"],
    ["용량 단위", "500mAh"],
    ["치수", "10cm"],
    ["모델코드", "IPX7"],
    ["숫자", "2024"],
    ["기호", "★"],
  ])("%s(%s)는 번역문이 같아도 실패로 치지 않는다", (_label, text) => {
    const r = pickTranslated([b(text)], [text]);
    expect(r.boxes).toHaveLength(0); // 바꿀 게 없어 렌더 대상은 아니고
    expect(r.untranslated).toEqual([]); // 그렇다고 검수로 보내지도 않는다
  });

  it("한자가 섞인 문구는 에코면 실패로 잡는다 — USB充电 같은 혼합", () => {
    expect(pickTranslated([b("USB充电")], ["USB充电"]).untranslated).toEqual(["USB充电"]);
  });

  it("여러 문구 중 실패한 것만 골라낸다", () => {
    const r = pickTranslated(
      [b("强震深处"), b("USB"), b("防水设计")],
      ["강렬한 진동", "USB", "防水设计"],
    );
    expect(r.boxes.map((x) => x.ko)).toEqual(["강렬한 진동"]);
    expect(r.untranslated).toEqual(["防水设计"]); // USB 는 안 섞인다
  });
});


/**
 * 패치 알파의 feather 는 **잘라낸 뒤** 다시 잡아야 한다.
 *
 * 실사례(2026-08-27 감사): clipRectAgainst 가 이웃을 피해 사각형을 줄이면서
 * feather 는 그대로 뒀다. 잘린 두께가 2×feather 보다 얇으면 alpha 계산
 * `min(1, edge/feather)` 이 어느 픽셀에서도 1 에 도달하지 못해 **패치 전체가
 * 반투명**으로 얹힌다 — 원문·워터마크가 유령처럼 비쳐 나오는, 무결 원칙이
 * 금지하는 "덧그린 흔적"의 생성기다.
 */
describe("clipRectAgainst — 잘라낸 뒤 feather 재계산", () => {
  const core = { x0: 100, y0: 100, x1: 200, y1: 108 };

  it("잘려서 얇아지면 feather 를 두께 절반 이하로 줄인다", () => {
    const r = { x0: 90, y0: 90, x1: 210, y1: 200, feather: 10 };
    // 이웃이 아래에서 올라와 높이가 90~120(30px)으로 잘린다 → feather 10 이면
    // edge 최댓값이 15 라 아슬아슬하지만, 더 얇아지면 255 에 못 닿는다
    const clipped = clipRectAgainst(r, core, [{ x0: 90, y0: 120, x1: 210, y1: 300 }]);
    const thickness = Math.min(clipped.x1 - clipped.x0, clipped.y1 - clipped.y0);
    expect(clipped.feather).toBeLessThanOrEqual(thickness / 2);
  });

  it("아주 얇게 잘려도 alpha 가 255 에 도달할 수 있어야 한다", () => {
    const thinCore = { x0: 100, y0: 100, x1: 200, y1: 104 };
    const r = { x0: 90, y0: 98, x1: 210, y1: 200, feather: 10 };
    const clipped = clipRectAgainst(r, thinCore, [{ x0: 90, y0: 106, x1: 210, y1: 300 }]);
    const h = clipped.y1 - clipped.y0;
    const maxEdge = Math.floor(Math.min(h, clipped.x1 - clipped.x0) / 2);
    // buildPatchOverlay: a = min(1, edge/feather)*255 — edge 최댓값이 feather 이상이어야 불투명해진다
    expect(maxEdge).toBeGreaterThanOrEqual(clipped.feather);
  });

  it("안 잘렸으면 feather 를 건드리지 않는다", () => {
    const r = { x0: 90, y0: 90, x1: 210, y1: 200, feather: 6 };
    expect(clipRectAgainst(r, core, []).feather).toBe(6);
  });

  it("feather 는 음수가 되지 않는다", () => {
    const r = { x0: 100, y0: 100, x1: 100, y1: 100, feather: 8 };
    expect(clipRectAgainst(r, core, []).feather).toBeGreaterThanOrEqual(0);
  });
});

/**
 * 운영자 개선 지시 — 재생성 프롬프트에 실제로 실려야 한다.
 * 지시를 받아 놓고 프롬프트에 안 넣으면 "재생성했는데 똑같다"가 된다.
 */
describe("regenPromptWithHint — 개선 지시가 프롬프트에 실린다", () => {
  const box = {
    box: [100, 100, 200, 900] as [number, number, number, number],
    zh: "强震深处",
    ko: "강렬한 진동",
    bg: "#ffffff",
    fg: "#000000",
  };

  it("지시가 없으면 기존 프롬프트와 같다", () => {
    expect(regenPromptWithHint([box])).toBe(regenPromptWithHint([box], ""));
  });

  it("지시를 주면 프롬프트에 그대로 들어간다", () => {
    const p = regenPromptWithHint([box], "글자가 잘렸으니 더 작게");
    expect(p).toContain("글자가 잘렸으니 더 작게");
  });

  it("지시가 있어도 절대 규칙은 유지된다", () => {
    const p = regenPromptWithHint([box], "배경을 바꿔주세요");
    expect(p).toContain("제품 사진");
    expect(p).toContain("강렬한 진동");
  });

  it("지나치게 긴 지시는 잘라 넣는다 (프롬프트 오염 방지)", () => {
    const p = regenPromptWithHint([box], "가".repeat(1000));
    expect(p.length).toBeLessThan(regenPromptWithHint([box]).length + 500);
  });
});
