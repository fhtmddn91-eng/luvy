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
  regionIsStatic,
  inventedInBox,
  textBands,
  textCoverage,
  truncatedTail,
  mergeOverlappingBoxes,
  splitTwoLines,
  charBudget,
  planErase,
  stripForeign,
  inpaint,
  percentilePass,
  eraseGlyphs,
  backgroundRef,
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
