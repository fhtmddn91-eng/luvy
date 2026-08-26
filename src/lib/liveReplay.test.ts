/**
 * live1 실측 산출물(원본·모델 전체 출력·OCR JSON)로 수정 전후 판정을 재생하는
 * 무료 회귀 테스트 — API 호출 없음. 산출물이 없는 환경(CI 등)에서는 건너뛴다.
 *
 * 재생 대상 (2026-08-24 실호출 1회분):
 *   - "上下拍打G点" 이 기본 패치 사각형에서 edge=116.5(상한 45)로 탈락한 사실
 *   - 세로 확장 후보도 확장 링 검증에서 거부되는 것 (링에 장식 "G" 변형이 들어온다)
 *   - 확정 문구 ↔ 판독문 엄격 일치·의미 검수 기준이 live1 의 놓친 사례를 잡는 것
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { seamGap, edgeCrossing, toPixelBox, gifPatchRect, chooseSafePatchRect, type OcrBox } from "./imageTranslate";
import { renderedTextMatches, extraTextInBox, buildMeaningPrompt, buildRenderedMeaningPrompt } from "./translateVerify";

const LIVE = "/private/tmp/claude-501/-Users-dooya8787-Desktop-luvy/75f7da84-1886-4374-b77c-38a5260c965e/scratchpad/live1";
const hasArtifacts =
  fs.existsSync(path.join(LIVE, "1-original.jpg")) &&
  fs.existsSync(path.join(LIVE, "2-model-full-output.png")) &&
  fs.existsSync(path.join(LIVE, "result.json"));

const SEAM_MAX = 48;
const EDGE_CROSS_MAX = 45;

/**
 * 추가 진단용 재생 — 산출물이 이 머신 스크래치에만 있어 다른 환경에선 건너뛴다.
 * 출시 회귀 증거는 항상 실행되는 합성 픽스처(patchRectChoice.test.ts)가 담당한다.
 */
describe.skipIf(!hasArtifacts)("live1 재생(진단) — 패치 경계 판정", () => {
  it("上下拍打G点: 기본 사각형은 edge 초과, 확장 후보는 링의 장식 G 변형으로 거부 → null", async () => {
    const orig = fs.readFileSync(path.join(LIVE, "1-original.jpg"));
    const regenFile = fs.readFileSync(path.join(LIVE, "2-model-full-output.png"));
    const result = JSON.parse(fs.readFileSync(path.join(LIVE, "result.json"), "utf8")) as {
      boxes: { box: [number, number, number, number]; zh: string; ko: string }[];
    };
    const meta = await sharp(orig).metadata();
    const W = meta.width!;
    const H = meta.height!;
    // callImageEdit 와 동일하게 모델 출력을 원본 크기로 맞춘다
    const regenPng = await sharp(regenFile).resize(W, H, { fit: "fill" }).png().toBuffer();
    const o = new Uint8Array(await sharp(orig).ensureAlpha().raw().toBuffer());
    const r = new Uint8Array(await sharp(regenPng).ensureAlpha().raw().toBuffer());

    const boxes = result.boxes as unknown as OcrBox[];
    const target = boxes.find((b) => b.zh.includes("拍打G"))!;
    expect(target).toBeDefined();
    const others = boxes.filter((b) => b !== target).map((b) => toPixelBox(b.box, W, H));

    // 수정 전 판정: 기본 사각형 — 실측 그대로 edge 상한 초과, seam 은 유한값(반올림 방어 확인)
    const base = gifPatchRect(target, W, H);
    const baseSeam = seamGap(o, r, W, H, base);
    const baseEdge = edgeCrossing(o, r, W, H, base);
    expect(Number.isFinite(baseSeam)).toBe(true);
    expect(baseSeam).toBeLessThanOrEqual(SEAM_MAX);
    expect(baseEdge).toBeGreaterThan(EDGE_CROSS_MAX); // 실측 116.5 — 탈락이 정답이었다
    expect(baseEdge).toBeGreaterThan(100);

    // 수정 후 판정: 세로 확장 후보는 seam·edge 를 통과하지만(17.1 / 31.4) **확장 링
    // 검증에서 거부**돼 최종적으로 null 이다 — 원문 유지 + PATCH_REJECTED 가 정답이다.
    //
    // 왜 거부가 맞는가 (2026-08-24 육안 확인, live3 에서 같은 현상 재확인):
    // 확장 링(문구 위 16px 띠)에는 장식용 대문자 "G"(x190~240, y716~778)의 아래쪽이
    // 들어온다. 모델은 그 G 를 원본과 다른 모양으로 다시 그렸다 — 원본은 안쪽이
    // 보라색으로 차 있고 모델 출력은 흰색이다(잉크 87 → 38 로 감소).
    // 이 후보를 채택하면 손님용 이미지의 영문 장식이 바뀐다.
    // 처음에는 이 조각을 "탭의 ㅌ 윗획"으로 잘못 읽고 임계값 문제로 보고했는데,
    // 6배 확대와 잉크 방향 실측으로 뒤집힌 진단이다 — 임계값을 풀었으면
    // 장식 변형이 그대로 손님에게 나갔다.
    const picked = chooseSafePatchRect(o, r, W, H, target, others);
    expect(picked).toBeNull();

    // 나머지 4개 문구 — 국소 이음매 게이트(2026-08-24) 이후의 실측 판정:
    //  · 柔软咬合: 기본 사각형 채택 (경계가 깨끗하다 — p99 39)
    //  · 奏响·符合: 기본 사각형은 국소 단차(p99 177·223)로 탈락하고, 확장 후보가
    //    깨끗한 경계(p99 4·25)로 채택된다 — 평균 seamGap 시절엔 이 단차가 그대로
    //    통과했었다 (같은 결함이 live3 A 패치에서 육안으로 확인된 사고)
    //  · A点震颤顶撞: 어느 후보도 깨끗하지 않아 거부 (기본 p99 92·연속 38px)
    const expected: Record<string, "base" | "scaled" | "reject"> = {
      奏响快乐和弦: "scaled",
      "符合亚洲女性尺寸 多种模式": "scaled",
      柔软咬合: "base",
      A点震颤顶撞: "reject",
    };
    for (const b of boxes.filter((x) => x !== target)) {
      const pick = chooseSafePatchRect(o, r, W, H, b, boxes.filter((x) => x !== b).map((x) => toPixelBox(x.box, W, H)));
      const want = expected[b.zh];
      expect(want).toBeDefined();
      if (want === "reject") expect(pick).toBeNull();
      else {
        expect(pick).not.toBeNull();
        expect(pick!.scaled).toBe(want === "scaled");
      }
    }
  }, 120_000);
});

const LIVE3 = "/private/tmp/claude-501/-Users-dooya8787-Desktop-luvy/75f7da84-1886-4374-b77c-38a5260c965e/scratchpad/live3";
const hasLive3 =
  fs.existsSync(path.join(LIVE3, "1-original.jpg")) &&
  fs.existsSync(path.join(LIVE3, "2-model-full-output.png")) &&
  fs.existsSync(path.join(LIVE3, "result.json"));

describe.skipIf(!hasLive3)("live3 재생(진단) — 국소 이음매 게이트 후 판정", () => {
  it("불량 A·G 는 거부되고 깨끗한 3개는 기존처럼 채택된다", async () => {
    const orig = fs.readFileSync(path.join(LIVE3, "1-original.jpg"));
    const regenFile = fs.readFileSync(path.join(LIVE3, "2-model-full-output.png"));
    const result = JSON.parse(fs.readFileSync(path.join(LIVE3, "result.json"), "utf8")) as {
      boxes: { box: [number, number, number, number]; zh: string; ko: string }[];
    };
    const meta = await sharp(orig).metadata();
    const W = meta.width!;
    const H = meta.height!;
    const regenPng = await sharp(regenFile).resize(W, H, { fit: "fill" }).png().toBuffer();
    const o = new Uint8Array(await sharp(orig).ensureAlpha().raw().toBuffer());
    const r = new Uint8Array(await sharp(regenPng).ensureAlpha().raw().toBuffer());
    const boxes = result.boxes as unknown as OcrBox[];

    const pickOf = (b: OcrBox) =>
      chooseSafePatchRect(o, r, W, H, b, boxes.filter((x) => x !== b).map((x) => toPixelBox(x.box, W, H)));

    // 불량 2건 — 경계 국소 단차 (실측: A p99 92·연속 50px — 배경 대각선이 눈에
    // 보이게 끊겼는데 평균 seamGap 10.8 로 통과했던 출시 차단 결함. G p99 173~185)
    expect(pickOf(boxes.find((b) => b.zh.includes("A点"))!)).toBeNull();
    expect(pickOf(boxes.find((b) => b.zh.includes("拍打"))!)).toBeNull();

    // 깨끗한 3건 — 기존과 같은 사각형이 그대로 채택 (게이트가 멀쩡한 패치를 안 건드린다)
    const clean: [string, boolean][] = [
      ["奏响", false], // 기본, p99 22
      ["尺寸", true], // 세로 확장 (base 는 edge 57.8 초과), p99 4
      ["柔软", false], // 기본, p99 38 — 합격군 상단이라 임계 60 의 여유 검증
    ];
    for (const [key, scaled] of clean) {
      const p = pickOf(boxes.find((b) => b.zh.includes(key))!);
      expect(p).not.toBeNull();
      expect(p!.scaled).toBe(scaled);
    }
  }, 120_000);
});

describe("live1 재생 — 문구 검증 (산출물 값 그대로, 픽셀 불필요)", () => {
  it("잔류 원문은 엄격 일치·환각 검사 양쪽에 걸린다", () => {
    // live1 실측: 판독문이 원문 그대로("上下拍打G点")였다
    expect(renderedTextMatches("G점 두드림 자극", "上下拍打G点")).toBe(false);
    expect(extraTextInBox("G점 두드림 자극", "上下拍打G点", "上下拍打G点").ok).toBe(false);
  });
  it("의미 유사한 축소·바꿔치기도 엄격 일치에서 실격 — 부드러운 흡입 밀착 → 부드러운 흡입", () => {
    expect(renderedTextMatches("부드러운 흡입 밀착", "부드러운 흡입")).toBe(false);
    expect(renderedTextMatches("부드러운 흡입", "부드러운  흡입!")).toBe(true); // 공백·부호만 허용
  });
  it("의미 검수 프롬프트가 live1 이 놓친 실격 기준을 명시한다 — 성적 강화·수식어 누락", () => {
    const pre = buildMeaningPrompt([{ zh: "奏响快乐和弦", ko: "쾌락의 하모니" }]);
    expect(pre).toContain("성적 표현이 강화");
    expect(pre).toContain("수식어");
    expect(pre).toContain('"奏响快乐和弦" → "쾌락의 하모니"');
    const post = buildRenderedMeaningPrompt([{ zh: "柔软咬合", observed: "부드러운 흡입" }]);
    expect(post).toContain("성적 표현 강화");
    expect(post).toContain("누락");
    expect(post).toContain("실제로 읽어온");
  });
});
