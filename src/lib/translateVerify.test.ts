import { describe, it, expect } from "vitest";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import {
  extractNumberTokens,
  numbersPreserved,
  newTextLines,
  outsidePatchDiff,
  extraTextInBox,
  buildMeaningPrompt,
  buildCorrectiveRetranslatePrompt,
  correctionRejected,
  meaningFailureDetail,
  parseMeaningVerdicts,
  mergeOcrPasses,
  detectTextLikeRegions,
  isLowConfidenceRegion,
  unexplainedTextRegions,
  buildPreserveList,
  rectHitsPreserved,
  preservedPixelDiff,
  preservedTextIntact,
  blocksRender,
  preRenderMappingIssues,
  parseSingleVerdict,
  matchExpectedSegments,
  type NormBox,
} from "./translateVerify";

describe("extraTextInBox — 박스 안 추가 문구 환각 (양방향)", () => {
  it("기대 문구 그대로면 통과", () => {
    expect(extraTextInBox("강렬한 진동", "强震", "강렬한 진동").ok).toBe(true);
  });
  it("공백·문장부호·띄어쓰기 차이는 허용", () => {
    expect(extraTextInBox("강렬한 진동", "强震", "강렬한  진동!").ok).toBe(true);
    expect(extraTextInBox("흡입+진동 강력 쾌감", "吮吸+震动", "흡입 + 진동, 강력 쾌감").ok).toBe(true);
  });
  it("기대 옆에 없던 말이 붙으면 실패 — 강렬한 진동 정품 보증", () => {
    const r = extraTextInBox("강렬한 진동", "强震", "강렬한 진동 정품 보증");
    expect(r.ok).toBe(false);
    expect(r.extra).toBe("정품보증");
  });
  it("원문에 있던 숫자·단위·라틴 장식은 남아 있어도 통과", () => {
    expect(extraTextInBox("53MIN 이상", "不低于53MIN", "53MIN 이상").ok).toBe(true);
    expect(extraTextInBox("로즈 스틱", "ROSE 拍打棒", "로즈 스틱 ROSE").ok).toBe(true);
  });
  it("원문에 없던 라틴·한자 추가는 실패", () => {
    expect(extraTextInBox("로즈 스틱", "拍打棒", "로즈 스틱 PREMIUM").ok).toBe(false);
    expect(extraTextInBox("부드러운 촉감", "柔软", "부드러운 촉감 正品").ok).toBe(false);
  });
  it("OCR 이 기대 문구 일부를 흘려도(잘림) 추가 문구 판정은 하지 않는다 — 잘림은 다른 검사 몫", () => {
    expect(extraTextInBox("강렬한 진동", "强震", "강렬한").ok).toBe(true);
  });
  it("낱자 하나 티끌은 허용", () => {
    expect(extraTextInBox("강렬한 진동", "强震", "강렬한 진동 ㅇ").ok).toBe(true);
  });
});

describe("extractNumberTokens — 보존 토큰 추출", () => {
  it("숫자+단위를 뽑는다", () => {
    expect(extractNumberTokens("不低于53MIN")).toEqual(["53MIN"]);
    expect(extractNumberTokens("3.7V 충전")).toEqual(["3.7V"]);
    expect(extractNumberTokens("약 90分贝")).toContain("90");
  });
  it("모델 코드는 통째로", () => {
    expect(extractNumberTokens("SHD-S549 사양")).toEqual(["SHD-S549"]);
  });
  it("숫자가 없으면 빈 배열", () => {
    expect(extractNumberTokens("柔软亲肤")).toEqual([]);
  });
});

describe("numbersPreserved — 숫자·단위·모델명 보존 (정책 9)", () => {
  it("전부 남아 있으면 통과", () => {
    expect(numbersPreserved("不低于53MIN", "53MIN 이상").ok).toBe(true);
    expect(numbersPreserved("约2-3小时", "약 2-3시간").ok).toBe(true);
  });
  it("숫자가 바뀌면 실패", () => {
    const r = numbersPreserved("53MIN", "35MIN 이상");
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["53MIN"]);
  });
  it("모델 코드 누락 실패", () => {
    expect(numbersPreserved("SHD-S549", "에스에이치디").ok).toBe(false);
  });
  it("단위 mAh·dB·% 보존", () => {
    expect(numbersPreserved("500mAh 56dB 30%", "500mAh, 56dB, 30%").ok).toBe(true);
  });
  it("숫자 없는 문구는 항상 통과", () => {
    expect(numbersPreserved("柔软亲肤", "부드러운 촉감").ok).toBe(true);
  });
});

describe("newTextLines — 없던 문구 생성 검출 (정책 9)", () => {
  const box: NormBox = [100, 100, 200, 500];
  it("아는 박스 안 줄은 새 글자가 아니다", () => {
    expect(newTextLines([{ box: [110, 120, 190, 480], text: "강력 진동" }], [box], [])).toEqual([]);
  });
  it("원본 판독에 있던 줄(로고·영문)은 제외", () => {
    expect(
      newTextLines([{ box: [800, 100, 850, 300], text: "LAYLA" }], [box], [{ text: "LAYLA" }]),
    ).toEqual([]);
  });
  it("어느 박스와도 안 겹치고 원본에도 없던 줄은 새 글자", () => {
    const out = newTextLines([{ box: [800, 100, 850, 300], text: "정품 보증" }], [box], [{ text: "LAYLA" }]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("정품 보증");
  });
  it("빈 텍스트는 무시", () => {
    expect(newTextLines([{ box: [800, 100, 850, 300], text: "  " }], [box], [])).toEqual([]);
  });
});

describe("outsidePatchDiff — 패치 밖 원본 보존 단언 (정책 9)", () => {
  const W = 10;
  const H = 10;
  const raw = () => new Uint8Array(W * H * 4).fill(200);
  it("동일하면 0", () => {
    expect(outsidePatchDiff(raw(), raw(), W, H, [{ x0: 2, y0: 2, x1: 5, y1: 5 }])).toBe(0);
  });
  it("패치 안 변화는 세지 않는다", () => {
    const out = raw();
    out[(3 * W + 3) * 4] = 0;
    expect(outsidePatchDiff(raw(), out, W, H, [{ x0: 2, y0: 2, x1: 5, y1: 5 }])).toBe(0);
  });
  it("패치 밖 한 픽셀 변화를 잡는다", () => {
    const out = raw();
    out[(8 * W + 8) * 4 + 1] = 0;
    expect(outsidePatchDiff(raw(), out, W, H, [{ x0: 2, y0: 2, x1: 5, y1: 5 }])).toBe(1);
  });
  it("tol 이하의 미세 차이는 허용", () => {
    const out = raw();
    out[(8 * W + 8) * 4] = 205;
    expect(outsidePatchDiff(raw(), out, W, H, [], 8)).toBe(0);
  });
});

describe("meaning 검수 프롬프트·응답", () => {
  it("프롬프트에 쌍과 개수가 들어간다", () => {
    const p = buildMeaningPrompt([{ zh: "强震", ko: "강력 진동" }]);
    expect(p).toContain('"强震" → "강력 진동"');
    expect(p).toContain("1개");
  });
  it("정상 응답 해석", () => {
    expect(parseMeaningVerdicts([{ ok: true, issues: [] }], 1)).toEqual([{ ok: true, issues: [], hard: [] }]);
  });
  it("개수 불일치·형식 오류는 null", () => {
    expect(parseMeaningVerdicts([{ ok: true }], 2)).toBeNull();
    expect(parseMeaningVerdicts([{ okay: true }], 1)).toBeNull();
    expect(parseMeaningVerdicts("no", 1)).toBeNull();
  });
});

describe("mergeOcrPasses — 교차 OCR 합의", () => {
  const b = (box: NormBox, zh: string) => ({ box, zh });
  it("좌표가 겹치면 합의", () => {
    const { merged, unconfirmed } = mergeOcrPasses(
      [b([100, 100, 150, 400], "强震深处")],
      [b([102, 98, 152, 396], "强震深处")],
    );
    expect(merged).toHaveLength(1);
    expect(unconfirmed).toHaveLength(0);
  });
  it("좌표가 어긋나도 원문이 같으면 합의", () => {
    const { unconfirmed } = mergeOcrPasses(
      [b([100, 100, 150, 400], "强震深处")],
      [b([300, 100, 350, 400], "强震深处")],
    );
    expect(unconfirmed).toHaveLength(0);
  });
  it("한쪽에만 있으면 unconfirmed 이고 merged 에는 포함", () => {
    const { merged, unconfirmed } = mergeOcrPasses(
      [b([100, 100, 150, 400], "强震深处")],
      [b([600, 100, 650, 400], "全新升级")],
    );
    expect(merged).toHaveLength(2);
    expect(unconfirmed).toHaveLength(2);
  });
  it("둘 다 비면 전부 빈다", () => {
    const { merged, unconfirmed } = mergeOcrPasses([], []);
    expect(merged).toHaveLength(0);
    expect(unconfirmed).toHaveLength(0);
  });
});

describe("buildCorrectiveRetranslatePrompt — 교정 재번역 요청문", () => {
  const item = { zh: "上下拍打G点", firstKo: "G점 탭 두드림", issues: ["핵심 수식어 누락: 上下(위아래)"], budget: 12 };
  it("문구마다 원문·기존 번역·검수 지적·글자 예산이 들어간다", () => {
    const p = buildCorrectiveRetranslatePrompt([item]);
    expect(p).toContain('"上下拍打G点"');
    expect(p).toContain('"G점 탭 두드림"');
    expect(p).toContain("핵심 수식어 누락: 上下(위아래)");
    expect(p).toContain("최대 12자");
  });
  it("교정 요구사항이 명시된다 — 바로잡기·보존·추가 금지·자연스러움·예산·한자 금지", () => {
    const p = buildCorrectiveRetranslatePrompt([item]);
    for (const req of ["바로잡으세요", "방향·수식어를 보존", "추가하지 마세요", "자연스러운 문구", "최대 N자", "절대 남기지 마세요", "똑같은 답을 다시 내지 마세요"]) {
      expect(p).toContain(req);
    }
  });
  it("여러 문구는 같은 순서로 번호가 붙는다 (배치 1회)", () => {
    const p = buildCorrectiveRetranslatePrompt([item, { zh: "柔软咬合", firstKo: "부드러운 흡입", issues: [], budget: 8 }]);
    expect(p.indexOf("上下拍打G点")).toBeLessThan(p.indexOf("柔软咬合"));
    expect(p).toContain("입력 (2개)");
  });
});

describe("correctionRejected — 교정 사용 불가 판정 (걸리면 즉시 MEANING_UNCERTAIN)", () => {
  it("정규화 기준 무변화(공백·부호 차이만)는 거부", () => {
    expect(correctionRejected("奏响快乐和弦", "쾌락의 하모니", "쾌락의  하모니!")).toContain("무변화");
  });
  it("빈 답·한자 잔류는 거부", () => {
    expect(correctionRejected("奏响", "즐거움", "  ")).toContain("빈");
    expect(correctionRejected("奏响", "즐거움", "快乐 하모니")).toContain("한자");
  });
  it("원문의 숫자·단위가 교정에서 빠지면 거부", () => {
    expect(correctionRejected("不低于53MIN", "53MIN 이상", "오래 지속")).toContain("53MIN");
  });
  it("실제로 달라진 교정은 통과(null)", () => {
    expect(correctionRejected("奏响快乐和弦", "쾌락의 하모니", "즐거운 화음")).toBeNull();
    expect(correctionRejected("不低于53MIN", "53MIN 이상", "최소 53MIN 지속")).toBeNull();
  });
});

describe("meaningFailureDetail — 운영자 사유 문자열", () => {
  it("원문·1차·교정·1차 지적·2차 지적이 전부 들어간다", () => {
    const d = meaningFailureDetail({
      zh: "上下拍打G点",
      firstKo: "G점 탭 두드림",
      correctedKo: "위아래 G점 두드림",
      firstIssues: ["上下 누락"],
      secondIssues: ["여전히 어색"],
    });
    for (const s of ["上下拍打G点", "G점 탭 두드림", "위아래 G점 두드림", "上下 누락", "여전히 어색"]) expect(d).toContain(s);
  });
  it("지적이 없으면 '-' 로, 400자에서 자른다", () => {
    const d = meaningFailureDetail({ zh: "a".repeat(500), firstKo: "b", correctedKo: "c", firstIssues: [], secondIssues: [] });
    expect(d.length).toBeLessThanOrEqual(400);
    expect(meaningFailureDetail({ zh: "原", firstKo: "일", correctedKo: "이", firstIssues: [], secondIssues: [] })).toContain("(-)");
  });
});


/* ── H1 — 글자처럼 보이는 영역 탐지 (OCR 과 독립된 픽셀 신호) ── */
describe("detectTextLikeRegions", () => {
  const SW = 400;
  const SH = 400;
  const paint = (draw: (ctx: SKRSContext2D) => void): Uint8Array => {
    const c = createCanvas(SW, SH);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SW, SH);
    draw(ctx);
    return new Uint8Array(ctx.getImageData(0, 0, SW, SH).data.buffer.slice(0));
  };
  /** 획으로 이뤄진 낱자가 늘어선 글줄 */
  const glyphs = (ctx: SKRSContext2D, y: number, color: string, o: { h?: number; w?: number; gap?: number; from?: number; to?: number } = {}) => {
    const { h = 22, w = 10, gap = 20, from = 50, to = 350 } = o;
    ctx.fillStyle = color;
    for (let x = from; x < to; x += gap) {
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(x, y, 2, h);
      ctx.fillRect(x + w - 2, y, 2, h);
      ctx.fillRect(x + 2, y + ((h / 2) | 0), w - 4, 2);
    }
  };

  it("빈 배경에서는 아무것도 찾지 않는다", () => {
    expect(detectTextLikeRegions(paint(() => {}), SW, SH)).toEqual([]);
  });

  it("그라데이션 배경만 있어도 글자로 보지 않는다", () => {
    const raw = paint((ctx) => {
      const g = ctx.createLinearGradient(0, 0, SW, SH);
      g.addColorStop(0, "#f4eef8");
      g.addColorStop(1, "#8a6fa5");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SW, SH);
    });
    expect(detectTextLikeRegions(raw, SW, SH)).toEqual([]);
  });

  it("통짜 색띠·도형은 글자가 아니다 — 낱자가 둘 이상이어야 글줄로 본다", () => {
    const raw = paint((ctx) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(40, 40, 320, 40);
    });
    expect(detectTextLikeRegions(raw, SW, SH)).toEqual([]);
  });

  it("글줄은 찾고, 글자가 빽빽해도 대역이 한 덩어리로 뭉치지 않는다", () => {
    const raw = paint((ctx) => glyphs(ctx, 48, "#000000"));
    const r = detectTextLikeRegions(raw, SW, SH);
    expect(r).toHaveLength(1);
    expect(r[0].glyphs).toBeGreaterThan(5); // 낱자가 따로 잡힌다 (배경 추정이 중앙값이라)
    expect(r[0].heightPx).toBeGreaterThanOrEqual(20);
  });

  it("여러 줄이면 줄마다 따로 잡는다", () => {
    const raw = paint((ctx) => {
      glyphs(ctx, 48, "#000000");
      glyphs(ctx, 240, "#000000");
    });
    expect(detectTextLikeRegions(raw, SW, SH)).toHaveLength(2);
  });

  it("작은 글자는 확신이 낮게 매겨진다", () => {
    const raw = paint((ctx) => glyphs(ctx, 300, "#000000", { h: 8, w: 5, gap: 10, from: 60, to: 200 }));
    const r = detectTextLikeRegions(raw, SW, SH);
    expect(r).toHaveLength(1);
    expect(r[0].confidence).toBeLessThan(0.7);
    expect(isLowConfidenceRegion(r[0])).toBe(true);
  });

  it("저대비 글자도 확신이 낮다", () => {
    const raw = paint((ctx) => glyphs(ctx, 200, "#dcdcdc"));
    const r = detectTextLikeRegions(raw, SW, SH);
    if (r.length > 0) expect(r[0].confidence).toBeLessThan(0.8);
  });

  it("하단의 작은 글자는 확신 값과 무관하게 낮음 취급 — 스펙·주의문구 자리", () => {
    expect(isLowConfidenceRegion({ box: [900, 100, 950, 800], heightPx: 12, contrast: 200, confidence: 1, glyphs: 9 })).toBe(true);
    expect(isLowConfidenceRegion({ box: [400, 100, 460, 800], heightPx: 24, contrast: 200, confidence: 1, glyphs: 9 })).toBe(false);
  });
});

describe("unexplainedTextRegions — 모든 문자 영역이 설명돼야 한다", () => {
  const region = (box: NormBox) => ({ box, heightPx: 20, contrast: 120, confidence: 1, glyphs: 5 });
  it("절반 이상 덮는 설명 박스가 있으면 통과", () => {
    expect(unexplainedTextRegions([region([100, 100, 200, 900])], [[90, 90, 210, 910]])).toEqual([]);
  });
  it("아무 박스도 안 덮으면 남는다", () => {
    expect(unexplainedTextRegions([region([600, 100, 700, 900])], [[90, 90, 210, 910]])).toHaveLength(1);
  });
  it("살짝만 겹치는 건 설명이 아니다", () => {
    expect(unexplainedTextRegions([region([100, 100, 200, 900])], [[190, 100, 260, 900]])).toHaveLength(1);
  });
});

/* ── H3 — 영문·브랜드·숫자·모델코드 보존 ── */
describe("buildPreserveList", () => {
  const line = (box: NormBox, text: string) => ({ box, text });
  it("번역 대상이 아닌 라틴·숫자 줄만 담는다", () => {
    const list = buildPreserveList(
      [line([100, 100, 200, 900], "强震深处"), line([300, 100, 340, 500], "TRIPLE STIM"), line([400, 100, 440, 300], "53MIN")],
      [[100, 100, 200, 900]],
    );
    expect(list.map((p) => p.text)).toEqual(["TRIPLE STIM", "53MIN"]);
  });
  it("번역 대상과 겹치는 줄은 제외 — 번역 경로가 책임진다", () => {
    expect(buildPreserveList([line([100, 100, 200, 900], "上下拍打G点")], [[100, 100, 200, 900]])).toEqual([]);
  });
  it("한글·한자만 있는 줄은 보존 목록이 아니다", () => {
    expect(buildPreserveList([line([600, 100, 700, 900], "부드러운 촉감")], [])).toEqual([]);
  });
});

describe("rectHitsPreserved — 보존 영역을 삼키는 패치는 쓸 수 없다", () => {
  const preserved = [{ box: [300, 300, 340, 700] as NormBox, text: "TRIPLE" }];
  it("겹치면 그 항목을 돌려준다", () => {
    // 보존 영역은 y300~340 · x300~700 (1000×1000 기준)
    expect(rectHitsPreserved({ x0: 350, y0: 310, x1: 500, y1: 330 }, 1000, 1000, preserved)?.text).toBe("TRIPLE");
    expect(rectHitsPreserved({ x0: 280, y0: 290, x1: 320, y1: 310 }, 1000, 1000, preserved)?.text).toBe("TRIPLE"); // 모서리만 걸쳐도
  });
  it("안 겹치면 null", () => {
    expect(rectHitsPreserved({ x0: 100, y0: 500, x1: 300, y1: 600 }, 1000, 1000, preserved)).toBeNull();
  });
});

describe("preservedPixelDiff / preservedTextIntact", () => {
  const W2 = 20;
  const H2 = 20;
  const raw = () => new Uint8Array(W2 * H2 * 4).fill(200);
  const preserved = [{ box: [250, 250, 500, 500] as NormBox, text: "AB1" }]; // y5~10, x5~10
  it("보존 영역 안이 그대로면 0", () => {
    expect(preservedPixelDiff(raw(), raw(), W2, H2, preserved)).toBe(0);
  });
  it("보존 영역 안 1px 변화를 잡는다", () => {
    const out = raw();
    out[(6 * W2 + 6) * 4] = 0;
    expect(preservedPixelDiff(raw(), out, W2, H2, preserved)).toBe(1);
  });
  it("보존 영역 밖 변화는 세지 않는다 (그건 outsidePatchDiff 몫)", () => {
    const out = raw();
    out[(18 * W2 + 18) * 4] = 0;
    expect(preservedPixelDiff(raw(), out, W2, H2, preserved)).toBe(0);
  });
  it("같은 자리에 같은 글자가 남아 있으면 통과", () => {
    expect(preservedTextIntact(preserved, [{ box: [250, 250, 500, 500], text: "AB1" }]).ok).toBe(true);
  });
  it("사라지면 실패", () => {
    expect(preservedTextIntact(preserved, []).missing).toEqual(["AB1"]);
  });
  it("글자는 같은데 자리가 다르면 실패 — 다른 곳의 같은 글자는 보존이 아니다", () => {
    expect(preservedTextIntact(preserved, [{ box: [800, 800, 900, 900], text: "AB1" }]).ok).toBe(false);
  });
  it("자리는 같은데 글자가 바뀌면 실패", () => {
    expect(preservedTextIntact(preserved, [{ box: [250, 250, 500, 500], text: "XY9" }]).ok).toBe(false);
  });
});

/* ── live10 실측 fixture (2026-08-24) — 개인정보·키·URL 없음, 원문/번역문만 ──
 * 실제 10장 검증에서 나온 응답·판정을 최소 형태로 옮겨, 네트워크 없이 재생한다. */
describe("의미검수 hard/soft 분리 — 과민 차단만 줄이고 위험은 그대로 막는다", () => {
  const v = (raw: unknown) => parseMeaningVerdicts(raw, 1)![0];

  it("soft(뜻은 맞는 축약·의역)만 있으면 렌더로 보낸다 — live10 #08", () => {
    // 亲肤硅胶&丝滑人体&人体工学设计 → 피부 친화 실리콘 & 실키 인체공학 디자인
    // 심사 지적: "'人体' 요소 누락" = 반복 표현 생략 → soft
    const verdict = v([{ ok: true, issues: ["반복 표현 '人体' 생략"], hard: [] }]);
    expect(blocksRender(verdict)).toBe(false);
  });

  it("hard(과장·성적 강화)는 계속 막는다 — live10 #01·#05", () => {
    expect(blocksRender(v([{ ok: false, issues: ["성적 표현 강화: 쾌락"], hard: ["성적 표현 강화: 쾌락"] }]))).toBe(true);
    expect(blocksRender(v([{ ok: false, issues: ["원문에 없는 과장 추가: 쾌감"], hard: ["원문에 없는 과장 추가: 쾌감"] }]))).toBe(true);
  });

  it("hard(원문 깨짐·판독 불가)는 계속 막는다 — live10 #10", () => {
    expect(blocksRender(v([{ ok: false, issues: ["원문 비문 — 번역이 추측"], hard: ["원문 비문 — 번역이 추측"] }]))).toBe(true);
  });

  it("hard(오역)는 계속 막는다 — live10 #07 亲肤→친환경", () => {
    expect(blocksRender(v([{ ok: false, issues: ["오역: 亲肤(피부 친화)를 '친환경'으로"], hard: ["오역: 亲肤"] }]))).toBe(true);
  });

  it("ok:false 인데 hard 를 비워 보내면 hard 로 친다 — 느슨한 해석 금지(fail-closed)", () => {
    const verdict = v([{ ok: false, issues: ["뭔가 이상"], hard: [] }]);
    expect(verdict.hard.length).toBeGreaterThan(0);
    expect(blocksRender(verdict)).toBe(true);
  });

  it("판정 자체가 없으면 통과가 아니다", () => {
    expect(blocksRender(undefined)).toBe(true);
  });

  it("프롬프트가 hard/soft 를 구조로 요구한다", () => {
    const p = buildMeaningPrompt([{ zh: "强震", ko: "강력 진동" }]);
    expect(p).toContain("hard");
    expect(p).toContain("soft");
    expect(p).toContain('"hard"');
    expect(p).toContain("확실하지 않으면 hard");
  });
});

describe("preRenderMappingIssues — 셀 복제·숫자 소실을 렌더 전에 막는다 (live10 #04)", () => {
  it("서로 다른 원문이 같은 번역문이면 복제 전조로 잡는다", () => {
    const r = preRenderMappingIssues([
      { zh: "产品尺寸:单位 (cm)", ko: "제품 크기: 단위 (cm)" },
      { zh: "产品噪音值: 小于50分贝", ko: "제품 크기: 단위 (cm)" },
    ]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toContain("产品噪音值");
  });
  it("같은 원문이 두 번 들어온 것(중복 판독)은 복제가 아니다", () => {
    const r = preRenderMappingIssues([
      { zh: "产品尺寸:单位 (cm)", ko: "제품 크기: 단위 (cm)" },
      { zh: "产品尺寸: 单位 (cm)", ko: "제품 크기: 단위 (cm)" },
    ]);
    expect(r.duplicates).toEqual([]);
  });
  it("번역 단계에서 숫자·단위가 빠지면 잡는다 — 이미지 호출 전에", () => {
    const r = preRenderMappingIssues([{ zh: "产品噪音值: 小于50分贝", ko: "소음 크기: 미만" }]);
    expect(r.numberLoss).toHaveLength(1);
    expect(r.numberLoss[0]).toContain("50");
  });
  it("숫자가 보존되면 통과", () => {
    const r = preRenderMappingIssues([
      { zh: "产品噪音值: 小于50分贝", ko: "소음 크기: 50dB 미만" },
      { zh: "充电时长: 约2-3小时", ko: "충전 시간: 약 2-3시간" },
    ]);
    expect(r.numberLoss).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });
});

/* ── live11 실측 버그 회귀 (2026-08-24) ── */
describe("parseSingleVerdict — 단일 객체 verdict (제품 무결성 심사)", () => {
  it("issues·hard 배열이 든 단일 객체를 배열로 오인하지 않는다 — live11 렌더 5장 전패 원인", () => {
    // 실제 응답 형태 그대로
    const v = parseSingleVerdict('{"ok":false,"issues":["제품이 2개→1개"],"hard":["제품이 2개→1개"]}');
    expect(v).toEqual({ ok: false, issues: ["제품이 2개→1개"], hard: ["제품이 2개→1개"] });
  });
  it("설명이 앞뒤에 붙어도 객체만 뽑는다", () => {
    expect(parseSingleVerdict('판정: {"ok":true,"issues":[],"hard":[]} 이상입니다')?.ok).toBe(true);
  });
  it("형식이 어긋나면 null — 통과가 아니다 (fail-closed)", () => {
    expect(parseSingleVerdict("깨진 응답")).toBeNull();
    expect(parseSingleVerdict('{"okay":true}')).toBeNull();
  });
});

describe("matchExpectedSegments — 개행 문구 매칭 (live11 #04·#06 '미검출' 대량 원인)", () => {
  const L = (text: string): { box: NormBox; text: string } => ({ box: [0, 0, 10, 10], text });
  it("개행 문구는 줄 단위로 쪼개 각 조각이 엄격 일치하면 통과", () => {
    const r = matchExpectedSegments("야외\n약 90dB", "户外\n约90分贝", [L("야외"), L("약 90dB")]);
    expect(r.ok).toBe(true);
    expect(r.seen).toBe("야외 약 90dB");
  });
  it("한 조각이라도 없으면 실격 — 기준 완화 아님", () => {
    expect(matchExpectedSegments("야외\n약 90dB", "户外\n约90分贝", [L("야외")]).ok).toBe(false);
  });
  it("한 줄 문구는 기존 엄격 일치 그대로", () => {
    expect(matchExpectedSegments("강렬한 진동", "强震", [L("강렬한  진동!")]).ok).toBe(true);
    expect(matchExpectedSegments("강렬한 진동", "强震", [L("강렬한")]).ok).toBe(false);
  });
  it("'&' 는 장식 부호 — OCR 이 흘려도 일치 (live11 #04)", () => {
    expect(matchExpectedSegments("제품 정보 & 사양", "产品信息&参数", [L("제품 정보 사양")]).ok).toBe(true);
  });
});

/* ── live11 #01 대응: 동의 번역과 진짜 사고를 가르는 기준 (기준 변경 전 회귀) ── */
describe("preRenderMappingIssues — 동의 번역은 통과, 실제 사고만 차단", () => {
  const box = (b: NormBox) => b;
  it("서로 떨어진 두 라벨이 같은 번역이면 통과 — 동의어는 정상 (live11 #01)", () => {
    // 酒红色(와인레드)·酒红(와인) 둘 다 "버건디" — 좌표가 겹치지 않으면 정상 동의 번역
    const r = preRenderMappingIssues([
      { zh: "酒红色", ko: "버건디", box: box([512, 477, 577, 616]) },
      { zh: "紫色", ko: "퍼플", box: box([923, 663, 988, 762]) },
      { zh: "酒红", ko: "버건디", box: box([100, 100, 150, 200]) }, // 멀리 떨어진 자리
    ]);
    expect(r.duplicates).toEqual([]);
  });
  it("좌표가 겹치는 두 박스가 같은 번역이면 차단 — OCR 중복/좌표 충돌", () => {
    const r = preRenderMappingIssues([
      { zh: "酒红色", ko: "버건디", box: box([512, 477, 577, 616]) },
      { zh: "酒红", ko: "버건디", box: box([550, 480, 577, 567]) }, // 안쪽에 포함
    ]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toContain("좌표 충돌");
  });
  it("숫자가 다른 원문이 같은 번역이면 차단 — 셀 복제 사고 (live10 #04)", () => {
    const r = preRenderMappingIssues([
      { zh: "产品尺寸: 单位 (cm)", ko: "제품 크기: 단위 (cm)", box: box([678, 108, 693, 386]) },
      { zh: "产品噪音值: 小于50分贝", ko: "제품 크기: 단위 (cm)", box: box([748, 543, 764, 881]) },
    ]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toContain("숫자 불일치");
  });
  it("좌표 정보가 없으면 보수적으로 차단한다 (fail-closed)", () => {
    const r = preRenderMappingIssues([
      { zh: "甲", ko: "같은말" },
      { zh: "乙", ko: "같은말" },
    ]);
    expect(r.duplicates).toHaveLength(1);
  });
  it("숫자 소실 검사는 그대로", () => {
    expect(preRenderMappingIssues([{ zh: "小于50分贝", ko: "소음 미만" }]).numberLoss).toHaveLength(1);
  });
});

/* ══ mergeOcrPasses 동작 동등성 (2026-08-24 편집 사고 복원 검증) ══
 * 편집 실수로 이 함수가 통째로 지워져 수동 복원했다(파일이 untracked 라 git 복구 불가).
 * 아래는 복원본이 **원래 계약**을 지키는지 live10 실측 박스로 못 박는 것이다:
 *   ① merged = full 전부 + 띠에만 있던 것(extra)  ② full 은 순서·내용 보존
 *   ③ 짝이 있으면 unconfirmed 에 안 들어간다      ④ 띠 하나는 full 하나만 소비 (1:1)
 * 호출부는 두 곳(①교차 OCR, extractForeignCross)이고 인자 순서는 (full, bands) 다. */
describe("mergeOcrPasses — 복원본 동작 동등성 (live10 fixture)", () => {
  const FIX = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "src/lib/__fixtures__/ocrBoxes.json"), "utf8"),
  ) as Record<string, { box: NormBox; zh: string; ko: string }[]>;

  it("실측 박스를 절반씩 나눠 넣어도 merged 는 full 전부 + 띠 전용분", () => {
    for (const key of ["live10-04", "live10-06", "live10-02"]) {
      const all = FIX[key];
      expect(all.length).toBeGreaterThan(3);
      const full = all.slice(0, Math.ceil(all.length / 2));
      const bands = all.slice(Math.ceil(all.length / 2));
      const { merged, unconfirmed } = mergeOcrPasses(full, bands);
      // ① full 은 하나도 빠지지 않고 앞에 그대로
      expect(merged.slice(0, full.length)).toEqual(full);
      // ② merged 는 full + (짝을 못 찾은 띠) — 총량은 full 이상 all 이하
      expect(merged.length).toBeGreaterThanOrEqual(full.length);
      expect(merged.length).toBeLessThanOrEqual(all.length);
      // ③ unconfirmed 는 merged 밖으로 새지 않는다
      for (const u of unconfirmed) expect(merged).toContain(u);
    }
  });

  it("완전히 같은 두 벌을 넣으면 전부 짝이 지어져 merged = full, unconfirmed 0", () => {
    const all = FIX["live10-06"];
    const { merged, unconfirmed } = mergeOcrPasses(all, all.map((b) => ({ ...b })));
    expect(merged).toHaveLength(all.length);
    expect(unconfirmed).toHaveLength(0);
  });

  it("띠 하나는 full 하나만 소비한다 — 같은 문구 3벌이면 2벌이 extra 로 남는다", () => {
    const b = { box: [100, 100, 200, 900] as NormBox, zh: "强震深处", ko: "" };
    const { merged, unconfirmed } = mergeOcrPasses([b], [{ ...b }, { ...b }, { ...b }]);
    expect(merged).toHaveLength(3); // full 1 + extra 2
    expect(unconfirmed).toHaveLength(2);
  });

  it("한쪽에만 있는 문구는 양쪽 다 unconfirmed 로 잡힌다 (기존 계약)", () => {
    const a = { box: [100, 100, 150, 400] as NormBox, zh: "强震深处", ko: "" };
    const c = { box: [600, 100, 650, 400] as NormBox, zh: "全新升级", ko: "" };
    const { merged, unconfirmed } = mergeOcrPasses([a], [c]);
    expect(merged).toEqual([a, c]);
    expect(unconfirmed).toEqual([a, c]);
  });
});
