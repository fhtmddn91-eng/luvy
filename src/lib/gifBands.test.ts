/**
 * GIF 정지 띠 선별 — 2026-08-31 전환의 핵심 판정.
 *
 * 실사례(H007): 글자 4개가 전 프레임 완전 정지인데도 옛 좌표 패치 관문에
 * 걸려 "GIF 정지 패치 실패"로 떨어졌다. 이제 띠 단위로 정지를 보고,
 * 띠가 움직이면 붙어 있던 이웃 때문에 통째로 버리지 않고 박스별로 다시 본다.
 */
import { describe, it, expect } from "vitest";
import { gifBandBudgetFor, gifCharBudget, keptOriginalDetail, movedMaskFromFrames, bandRegenPrompt, bandRetryHint, bandSeamProblem, bandGlyphShrink, bandGlyphColorShift, compositeBand, glyphExtent, regionStaticEnough, resolveBandOverlaps, seamSidesOf, staticBandsOf, staticRoomOf, type OcrBox } from "./imageTranslate";
import { buildBandQualityPrompt } from "./translateVerify";

const W = 200;
const H = 200;

/** 전부 같은 색인 프레임 하나 (RGBA) */
const frame = (): Uint8Array => new Uint8Array(W * H * 4).fill(200);

/** rect 안을 다른 색으로 칠해 "움직임"을 만든다 */
function move(f: Uint8Array, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const out = new Uint8Array(f);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      out[i] = 10;
      out[i + 1] = 10;
      out[i + 2] = 10;
    }
  }
  return out;
}

const box = (b: [number, number, number, number], zh = "字"): OcrBox => ({
  box: b, zh, ko: "글", bg: "#fff", fg: "#000",
});

describe("staticBandsOf", () => {
  it("전 프레임이 같으면 글자 박스가 한 띠로 묶여 통과한다", () => {
    const raws = [frame(), frame(), frame()];
    // 세로로 가까운 두 박스 — 패딩(60‰)이면 겹쳐 한 띠가 된다
    const groups = staticBandsOf([box([100, 100, 150, 400]), box([170, 100, 220, 400])], raws[0], movedMaskFromFrames(raws, W, H), W, H);
    expect(groups).toHaveLength(1);
    expect(groups[0].boxes).toHaveLength(2);
  });

  it("띠 안에 움직이는 부분이 있으면 그 띠는 통째로 쓰지 않는다", () => {
    // 두 박스 사이 여백(픽셀 y 32~40)에 애니메이션 — 띠로 묶으면 얼어붙는다
    const f0 = frame();
    const raws = [f0, move(f0, 0, 32, W, 40)];
    const groups = staticBandsOf([box([100, 100, 150, 400]), box([220, 100, 270, 400])], raws[0], movedMaskFromFrames(raws, W, H), W, H);
    // 띠는 탈락하고, 박스별로 다시 봐도 그 여백을 물면 함께 탈락한다
    expect(groups.every((g) => g.boxes.length === 1)).toBe(true);
  });

  it("한 박스만 움직이면 나머지는 살린다 — 통째로 버리지 않는다", () => {
    const f0 = frame();
    // 아래쪽 박스 자리(픽셀 y 160~180)만 움직인다
    const raws = [f0, move(f0, 20, 160, 100, 180)];
    const groups = staticBandsOf([box([100, 100, 150, 400], "위"), box([820, 100, 890, 480], "아래")], raws[0], movedMaskFromFrames(raws, W, H), W, H);
    const kept = groups.flatMap((g) => g.boxes.map((b) => b.zh));
    expect(kept).toContain("위");
    expect(kept).not.toContain("아래");
  });

  it("글자가 전부 움직이는 화면 위면 빈 배열 — 얼려붙이지 않는다", () => {
    const f0 = frame();
    const raws = [f0, move(f0, 0, 0, W, H)];
    expect(staticBandsOf([box([100, 100, 150, 400])], raws[0], movedMaskFromFrames(raws, W, H), W, H)).toEqual([]);
  });

  it("띠 안이 조금이라도 움직이면 통과시키지 않는다 — 1%도 얼어붙는다", () => {
    // 실측(gifB): 기본 허용치 1% 로 통과한 띠가 그 영역 움직임을 13.7%→5.4% 로 얼렸다
    const f0 = frame();
    const raws = [f0, move(f0, 60, 60, 68, 68)]; // 8x8px = 띠의 1% 미만
    expect(staticBandsOf([box([250, 250, 350, 700])], raws[0], movedMaskFromFrames(raws, W, H), W, H)).toEqual([]);
  });

  it("흩어진 정지 띠는 사이가 정지면 하나로 합친다 — 호출 1회로 전부 번역", () => {
    const raws = [frame(), frame()];
    const groups = staticBandsOf([box([60, 100, 90, 400], "위"), box([800, 100, 830, 400], "아래")], raws[0], movedMaskFromFrames(raws, W, H), W, H);
    expect(groups).toHaveLength(1);
    expect(groups[0].boxes).toHaveLength(2);
  });

  it("띠 사이가 움직이면 합치지 않는다 — 그 사이가 얼어붙는다", () => {
    const f0 = frame();
    const raws = [f0, move(f0, 0, 100, W, 130)]; // 두 띠 사이 가로 줄이 움직임
    const groups = staticBandsOf([box([60, 100, 90, 400], "위"), box([800, 100, 830, 400], "아래")], raws[0], movedMaskFromFrames(raws, W, H), W, H);
    expect(groups.length).toBeGreaterThan(1);
  });

  it("번역문이 길면 막히지 않은 쪽으로 넓힌다 — 한쪽이 움직여도 다른 쪽 여유를 쓴다", () => {
    // 실측(2026-09-02 M18 「回弹设计」): 왼쪽 위 제품 사진이 움직여 양쪽 동시 확장이
    // 첫 걸음에 멈췄고, 오른쪽에 여유가 있는데도 띠가 좁아 글자가 가장자리에 닿았다.
    const f0 = frame();
    const f1 = move(f0, 0, 0, 50, 200); // 왼쪽 x<50 이 움직인다
    const moved = movedMaskFromFrames([f0, f1], W, H);
    const b = { ...box([450, 300, 550, 500], "字"), ko: "글글" }; // x 60~100, y 90~110
    const [g] = staticBandsOf([b], f0, moved, W, H);
    expect(g).toBeDefined();
    expect(g.band.left).toBeGreaterThanOrEqual(50);
    expect(g.band.left + g.band.width).toBeGreaterThanOrEqual(130); // 오른쪽으로 넓혔다
  });

  it("납작한 띠는 막히지 않은 쪽으로 두껍게 한다 — 위가 움직이면 아래로", () => {
    const f0 = frame();
    const f1 = move(f0, 0, 0, 200, 80); // 위쪽 y<80 이 움직인다
    const moved = movedMaskFromFrames([f0, f1], W, H);
    const b = box([480, 100, 520, 900], "字"); // x 20~180, y 96~104 → 160×8 (납작)
    const [g] = staticBandsOf([b], f0, moved, W, H);
    expect(g).toBeDefined();
    expect(g.band.top).toBeGreaterThanOrEqual(80);
    expect(g.band.top + g.band.height).toBeGreaterThanOrEqual(126);
  });

  it("글자를 많이 담은 띠가 먼저 온다 — 호출 1회를 가장 값진 띠에 쓴다", () => {
    const raws = [frame(), frame()];
    const groups = staticBandsOf(
      [box([60, 100, 90, 400], "혼자"), box([500, 100, 530, 400], "둘1"), box([560, 100, 590, 400], "둘2")],
      raws[0], movedMaskFromFrames(raws, W, H), W, H,
    );
    expect(groups[0].boxes.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * 겹치는 띠 정리 — "글자가 두 겹으로 찍힘"의 진짜 원인 (2026-09-01 마리아 0019 실측).
 * 제목 띠(y159~207)와 부제 띠(y187~247)가 겹쳐, 겹친 자리에 패치를 두 번 얹으면서
 * 부제 패치가 그린 제목 꼬리가 제목 위에 덧찍혔다.
 */
describe("resolveBandOverlaps", () => {
  const W = 750, H = 534;
  /** 세로로 떨어진 두 문구 (제목 y300~370‰, 부제 y380~440‰) */
  const title: OcrBox = { box: [300, 60, 370, 250], zh: "强劲伸缩", ko: "강력한 신축", bg: "#fff", fg: "#000" };
  const sub: OcrBox = { box: [380, 40, 440, 330], zh: "如炮机般地冲撞", ko: "대포처럼 격렬한 찌르기", bg: "#fff", fg: "#000" };

  it("합집합이 정지면 하나로 합친다 — 호출도 한 번으로 준다", () => {
    const groups = [
      { band: { left: 43, top: 159, width: 139, height: 48 }, boxes: [title] },
      { band: { left: 30, top: 187, width: 219, height: 60 }, boxes: [sub] },
    ];
    const out = resolveBandOverlaps(groups, W, H, () => true);
    expect(out).toHaveLength(1);
    expect(out[0].boxes).toHaveLength(2);
  });

  it("합칠 수 없으면 글자 사이에서 잘라 나눈다 — 어느 문구도 잃지 않는다", () => {
    const groups = [
      { band: { left: 43, top: 159, width: 139, height: 48 }, boxes: [title] },
      { band: { left: 30, top: 187, width: 219, height: 60 }, boxes: [sub] },
    ];
    const out = resolveBandOverlaps(groups, W, H, () => false);
    expect(out).toHaveLength(2);
    const [a, b] = out;
    // 더 이상 겹치지 않는다
    const overlap =
      a.band.left < b.band.left + b.band.width && b.band.left < a.band.left + a.band.width &&
      a.band.top < b.band.top + b.band.height && b.band.top < a.band.top + a.band.height;
    expect(overlap).toBe(false);
    // 각 띠는 자기 글자를 여전히 담는다
    expect(a.band.top + a.band.height).toBeGreaterThan((370 / 1000) * H);
    expect(b.band.top).toBeLessThan((380 / 1000) * H);
  });

  it("글자 자리까지 겹치면(겹쳐 인쇄된 원본) 하나만 남긴다 — 반쪽만 덮으면 원문이 비친다", () => {
    const over: OcrBox = { ...sub, box: [305, 60, 365, 250] }; // 제목과 같은 자리
    const groups = [
      { band: { left: 40, top: 155, width: 150, height: 50 }, boxes: [title, over] },
      { band: { left: 45, top: 158, width: 140, height: 45 }, boxes: [over] },
    ];
    const out = resolveBandOverlaps(groups, W, H, () => false);
    expect(out).toHaveLength(1);
    expect(out[0].boxes.length).toBe(2); // 글자를 더 많이 담은 쪽이 남는다
  });
});

describe("seamSidesOf", () => {
  it("맞닿은 변을 이음매로 표시한다 — 그 변을 페더하면 원문이 비쳐 나온다", () => {
    const upper = { left: 30, top: 159, width: 219, height: 43 };
    const lower = { left: 30, top: 202, width: 219, height: 45 };
    expect(seamSidesOf(upper, [upper, lower]).bottom).toBe(true);
    expect(seamSidesOf(lower, [upper, lower]).top).toBe(true);
    expect(seamSidesOf(upper, [upper, lower]).left).toBe(false);
  });

  it("떨어져 있는 띠는 이음매가 아니다", () => {
    const a = { left: 30, top: 100, width: 100, height: 40 };
    const b = { left: 30, top: 300, width: 100, height: 40 };
    expect(seamSidesOf(a, [a, b])).toEqual({ left: false, top: false, right: false, bottom: false });
  });
});

/**
 * 이음매 관문 — "얹으면 네모 자국이 보이는가"를 픽셀로 본다.
 * 실측(2026-09-01 운영 4장·띠 10개): 정상 결과는 seamGap 0.4~9.6 · p99 1~18 로
 * 한계(48)에 한참 못 미쳐 전부 통과했다. 잡아야 하는 것은 배경이 어긋난 패치다.
 */
describe("bandSeamProblem", () => {
  const W = 200, H = 120;
  const band = { left: 40, top: 30, width: 100, height: 50 };
  /** 균일한 회색 원본 */
  const orig = (() => {
    const a = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { a[i * 4] = 200; a[i * 4 + 1] = 200; a[i * 4 + 2] = 200; a[i * 4 + 3] = 255; }
    return a;
  })();
  const patchOf = (v: number) => {
    const b = Buffer.alloc(band.width * band.height * 4);
    for (let i = 0; i < band.width * band.height; i++) { b[i * 4] = v; b[i * 4 + 1] = v; b[i * 4 + 2] = v; b[i * 4 + 3] = 255; }
    return b;
  };

  it("배경이 원본과 같으면 통과한다", () => {
    expect(bandSeamProblem(orig, patchOf(200), band, W, H)).toBeNull();
  });

  it("배경 밝기가 어긋난 패치는 잡는다 — 네모 자국이 보이는 상태", () => {
    const p = bandSeamProblem(orig, patchOf(120), band, W, H);
    expect(p).toMatch(/이음매가 보입니다/);
  });

  it("몇 단계 밝기 차이(압축 노이즈 수준)는 통과시킨다 — 과잉 거부 금지", () => {
    expect(bandSeamProblem(orig, patchOf(196), band, W, H)).toBeNull();
  });

  it("경계는 맞는데 안쪽만 밝게 그린 패치를 잡는다 — 사각 자국", () => {
    // 실측(2026-09-01 M19 「눈으로 보는 강력 진동」): 경계 검사를 통과했는데
    // 띠 자리에 밝은 사각형이 남았다. 정상 띠는 배경 밝기 차 0.1~3.3, 이건 13.7.
    const p = Buffer.alloc(band.width * band.height * 4);
    for (let i = 0; i < band.width * band.height; i++) {
      const x = i % band.width, y = (i / band.width) | 0;
      // 테두리 2px 은 원본과 같게, 안쪽만 밝게
      const edge = x < 2 || y < 2 || x >= band.width - 2 || y >= band.height - 2;
      const v = edge ? 200 : 218;
      p[i * 4] = v; p[i * 4 + 1] = v; p[i * 4 + 2] = v; p[i * 4 + 3] = 255;
    }
    expect(bandSeamProblem(orig, p, band, W, H)).toMatch(/덧댄 자국/);
  });
});

/**
 * 띠 전용 프롬프트 — 관문이 재는 것을 그대로 지시하는가.
 * 예전엔 전체 이미지용 프롬프트를 그대로 써서, 관문이 떨어뜨리는 세 가지를
 * 모델에게 한마디도 말하지 않았다 (실측 M18: 띠 3개 중 1개가 재시도 뒤에도 탈락).
 */
describe("bandRegenPrompt", () => {
  const boxes: OcrBox[] = [
    { box: [100, 100, 200, 900], zh: "强劲伸缩", ko: "강력한 신축", bg: "#fff", fg: "#000" },
    { box: [210, 100, 280, 900], zh: "如炮机般地冲撞", ko: "대포처럼 격렬한 찌르기", bg: "#fff", fg: "#000" },
  ];
  const p = bandRegenPrompt(boxes, { width: 219, height: 45 });

  it("띠 크기를 알려 준다 — 확대·축소·여백 추가를 막는다", () => {
    expect(p).toContain("219×45");
  });

  it("이음매 관문이 재는 '네 변 가장자리 색'을 지시한다", () => {
    expect(p).toMatch(/가장자리 픽셀 색/);
  });

  it("육안 관문이 재는 '같은 문구 두 번 그리기 금지'를 지시한다", () => {
    expect(p).toMatch(/같은 문구를 두 번 그리면 실패/);
  });

  it("글자 크기를 원문대로 유지하라고 지시한다 — 작아지면 티가 난다", () => {
    // 실측: 폭이 모자라면 모델이 글자를 61%까지 줄였다
    expect(p).toMatch(/글자 크기는 원문과 같게 유지/);
    expect(p).toMatch(/자간을 좁혀/);
  });

  it("문구마다 글자 높이를 픽셀로 적는다 — '같게 유지'라는 말만으로는 띠 절반이 작아졌다", () => {
    // 실측(2026-09-02, exp7~9 산출물 3회분·띠 22개): 번역이 짧아도(「全面覆盖」→4자)
    // 세 번 다 75~82% 로 작아진 띠가 있었다. 모델이 잴 수 있는 수치를 준다.
    const q = bandRegenPrompt(
      [{ box: [200, 100, 600, 900], zh: "强劲伸缩", ko: "강력한 신축", bg: "#fff", fg: "#000" }],
      { width: 300, height: 100 },
    );
    expect(q).toContain("글자 높이 약 40px");
    expect(q).toMatch(/장체|글자 폭을 좁혀/);
  });

  it("띠 안 여백을 알려 주고, 가장자리에 닿느니 줄을 옮기거나 아주 조금 줄이라고 말한다", () => {
    // 실측(2026-09-02 exp10): 위 여백 1px 띠에서 한국어 글자가 위 가장자리에 닿아
    // 이음매 관문(연속 217px)에 두 번 다 걸려 원문이 남았다. 아래엔 12px 여유가 있었다.
    const q = bandRegenPrompt(
      [{ box: [100, 100, 700, 900], zh: "回弹设计", ko: "쿠션 설계", bg: "#fff", fg: "#000" }],
      { width: 300, height: 100 },
      { margins: { top: 2, bottom: 24, left: 60, right: 60 } },
    );
    expect(q).toMatch(/위 2px/);
    expect(q).toMatch(/아래 24px/);
    expect(q).toMatch(/3px 이상/);
    expect(q).toMatch(/10%/);
  });

  it("색이 바뀌는 지점을 단어 경계로 지시한다 — 실측: '인체공/학설계' 로 갈렸다", () => {
    expect(p).toMatch(/단어 경계/);
  });

  it("확정 번역문을 그대로 싣는다 — 모델 임의 번역 금지", () => {
    expect(p).toContain('"强劲伸缩" → "강력한 신축"');
    expect(p).toContain('"如炮机般地冲撞" → "대포처럼 격렬한 찌르기"');
  });

  it("유지(keep) 문구는 목록에 넣지 않는다 — 모델이 건드리면 안 된다", () => {
    const withKeep = bandRegenPrompt(
      [...boxes, { box: [300, 100, 360, 900], zh: "防水", ko: "", bg: "#fff", fg: "#000", mode: "keep" }],
      { width: 219, height: 90 },
    );
    expect(withKeep).not.toContain("防水");
  });
});

describe("bandRetryHint", () => {
  it("이음매 실패에는 배경·가장자리를 고치라고 말한다", () => {
    expect(bandRetryHint("이음매가 보입니다 (경계 색차 60)")).toMatch(/가장자리 픽셀은 원본 그대로/);
  });
  it("겹침 실패에는 한 번만 쓰라고 말한다", () => {
    expect(bandRetryHint("글자 품질 불합격: 제목이 겹쳐 찍힘")).toMatch(/정확히 한 번만/);
  });
  it("잔류 실패에는 원문을 지우라고 말한다", () => {
    expect(bandRetryHint("원문 잔류: 强劲伸缩")).toMatch(/원문 획을 완전히 지우고/);
  });
  it("작아진 실패에는 실측 비율과 함께 높이를 지키고 폭으로 흡수하라고 말한다", () => {
    const h = bandRetryHint("글자가 작아졌습니다 (원문의 61%)");
    expect(h).toContain("61%");
    expect(h).toMatch(/줄이지/);
    expect(h).toMatch(/장체|자간/);
  });

  it("모르는 사유는 그대로 전달한다 — 삼키지 않는다", () => {
    expect(bandRetryHint("알 수 없는 사유 XYZ")).toContain("알 수 없는 사유 XYZ");
  });
});

/**
 * 글자 실제 범위 — 판독 박스가 획 끝을 자를 때 그만큼을 찾아낸다.
 * 실측(2026-09-01): 오버슈트 0~5px. 「쿠션 설계 다채로운 자세 체감」은 4px 이었고,
 * 여백 4px 짜리 띠에서 실제로 원문 획이 남았다 — 측정이 결함을 재현한다.
 */
describe("glyphExtent", () => {
  const W = 200, H = 80;
  /** 배경 위에 획을 그려 raw 를 만든다 */
  const make = (draw: (set: (x: number, y: number, v: number) => void) => void, bgAt = (_x: number, _y: number) => 235) => {
    const a = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = bgAt(x, y);
      a[i] = v; a[i + 1] = v; a[i + 2] = v; a[i + 3] = 255;
    }
    draw((x, y, v) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      a[i] = v; a[i + 1] = v; a[i + 2] = v;
    });
    return a;
  };

  it("박스 밖으로 삐져나온 획을 찾아낸다", () => {
    // 박스 40~60. 세로획(4px 두께) + 오른쪽으로 뻗은 가로획이 x 65 까지 (오버슈트 5px)
    const raw = make((set) => {
      for (let y = 30; y < 50; y++) for (let x = 44; x < 48; x++) set(x, y, 20);
      for (let y = 38; y < 42; y++) for (let x = 48; x <= 65; x++) set(x, y, 20);
    });
    const g = glyphExtent(raw, W, H, { x0: 40, y0: 28, x1: 60, y1: 52 });
    expect(g.x1).toBeGreaterThanOrEqual(65);
    expect(g.x1 - 60).toBeGreaterThanOrEqual(4); // 오버슈트를 잡았다
  });

  it("이어지지 않은 구조물(카드 테두리)은 딸려오지 않는다", () => {
    const raw = make((set) => {
      for (let y = 30; y < 50; y++) for (let x = 44; x < 48; x++) set(x, y, 20); // 글자 획
      for (let y = 0; y < H; y++) { set(100, y, 30); set(101, y, 30); } // 멀리 떨어진 테두리
    });
    const g = glyphExtent(raw, W, H, { x0: 40, y0: 28, x1: 60, y1: 52 });
    expect(g.x1).toBeLessThan(70); // 테두리(x=100)까지 번지지 않았다
  });

  it("그라데이션 배경에서 확장이 폭주하지 않는다", () => {
    // 앞선 두 시도(전역 배경 추정)가 무너진 조건 — 국소 배경이라 튀지 않는다
    const raw = make(
      (set) => { for (let y = 30; y < 50; y++) for (let x = 44; x < 48; x++) set(x, y, 20); },
      (x) => 180 + Math.round(x * 0.3),
    );
    const g = glyphExtent(raw, W, H, { x0: 40, y0: 28, x1: 60, y1: 52 });
    expect(g.x1 - 60).toBeLessThanOrEqual(8);
    expect(g.y1 - 52).toBeLessThanOrEqual(8);
  });

  it("글자가 박스 안에 딱 맞으면 박스 그대로", () => {
    const raw = make((set) => {
      for (let y = 32; y < 48; y++) for (let x = 46; x < 50; x++) set(x, y, 20);
    });
    const g = glyphExtent(raw, W, H, { x0: 40, y0: 28, x1: 60, y1: 52 });
    expect(g.x0).toBeGreaterThanOrEqual(40 - 1);
    expect(g.x1).toBeLessThanOrEqual(60 + 1);
  });
});

/**
 * 정지 판정 — **비율이 아니라 절대 크기**로 본다.
 *
 * 실측(2026-09-01): "움직인 픽셀 0개" 규칙 때문에 M18 의 「全面覆盖」·「大头爆震」이
 * 통째로 버려졌는데, 그 영역은 글자도 배경도 99.8~100% 정지였고 움직인 것은
 * 잡티 9픽셀뿐이었다. 얼려도 애니메이션 손실은 11픽셀(0.11%)로 눈에 안 보인다.
 * 반대로 진짜 애니메이션은 수백~수천 픽셀이 덩어리로 움직인다.
 */
describe("regionStaticEnough", () => {
  const W = 60, H = 40;
  const frames = (paint: (f: number, set: (x: number, y: number) => void) => void, n = 4) => {
    const out: Uint8Array[] = [];
    for (let f = 0; f < n; f++) {
      const a = new Uint8Array(W * H * 4).fill(200);
      for (let i = 3; i < a.length; i += 4) a[i] = 255;
      paint(f, (x, y) => {
        const i = (y * W + x) * 4;
        a[i] = 10; a[i + 1] = 10; a[i + 2] = 10;
      });
      out.push(a);
    }
    return out;
  };
  const rect = { x0: 0, y0: 0, x1: W, y1: H };

  it("완전 정지는 통과", () => {
    expect(regionStaticEnough(movedMaskFromFrames(frames(() => {}), W, H), W, rect)).toBe(true);
  });

  it("흩어진 잡티 몇 픽셀은 통과 — 얼려도 보이지 않는다", () => {
    const fs2 = frames((f, set) => {
      if (f === 0) return;
      set(3, 3); set(20, 8); set(40, 30); set(55, 12); // 서로 떨어진 4점
    });
    expect(regionStaticEnough(movedMaskFromFrames(fs2, W, H), W, rect)).toBe(true);
  });

  it("작아도 덩어리로 움직이면 막는다 — 얼면 자국이 보인다", () => {
    const fs2 = frames((f, set) => {
      if (f === 0) return;
      for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) set(x, y); // 4x4 = 16px 덩어리
    });
    expect(regionStaticEnough(movedMaskFromFrames(fs2, W, H), W, rect)).toBe(false);
  });

  it("총량이 크면 막는다 — 진짜 애니메이션", () => {
    const fs2 = frames((f, set) => {
      if (f === 0) return;
      for (let x = 0; x < W; x += 2) set(x, 20); // 30px, 흩어져 있지만 총량 초과
    });
    expect(regionStaticEnough(movedMaskFromFrames(fs2, W, H), W, rect)).toBe(false);
  });
});

/**
 * 앞으로 들어올 GIF 를 위한 안전장치 — 지금 카탈로그에 없는 모양까지 견딘다.
 */
describe("gifBandBudgetFor", () => {
  it("띠 수에 재시도 여유 3 을 더한다 — 고정 6 이라 띠 6개 GIF 가 잘렸다", () => {
    // 실측(마리아 0018): 띠 6 · 예산 6 → 재시도 한 번에 마지막 띠가 호출을 못 받고
    // 「360°贴合」·「回弹设计」이 중국어로 남았다
    expect(gifBandBudgetFor(1)).toBe(4);
    expect(gifBandBudgetFor(4)).toBe(7);
    expect(gifBandBudgetFor(6)).toBe(9);
  });

  it("아무리 많아도 상한을 넘지 않는다 — 비용 폭주 방지", () => {
    expect(gifBandBudgetFor(20)).toBe(10);
    expect(gifBandBudgetFor(100)).toBe(10);
  });
});

describe("띠 프롬프트 — 앞으로 들어올 모양 대비", () => {
  const p2 = bandRegenPrompt(
    [{ box: [100, 100, 200, 900], zh: "强劲", ko: "강력", bg: "#fff", fg: "#000" }],
    { width: 200, height: 50 },
  );
  it("세로쓰기를 유지하라고 지시한다 — 중국 상세페이지에 흔한 형태", () => {
    // 전체 이미지용 프롬프트에는 있었는데 띠 전용으로 분리하며 빠져 있었다
    expect(p2).toMatch(/세로로 쓴 글자는 세로로/);
  });
});

/**
 * 글자 크기 관문 — 실측(2026-09-02, exp7~9 M18/M19 산출물 3회분 · 띠 22개):
 * 정상은 원문 높이의 88~135%, 작아진 것은 45~83% 였다. 「全面覆盖」는 번역이
 * 4자로 짧아도 세 번 다 75~82% 로 작아졌다 — "같게 유지"라는 지시만으로는
 * 절반이 어긴다(규칙 4). 픽셀로 재서(공짜) 재시도 힌트에 실측값을 싣고,
 * 그래도 작으면 더 나은 쪽을 채택하되 사유를 남긴다.
 */
describe("bandGlyphShrink — 글자가 원문보다 작게 그려졌나 (픽셀, 호출 0회)", () => {
  const W = 200, H = 120;
  const band = { left: 40, top: 30, width: 100, height: 50 };
  const nb = (y0: number, x0: number, y1: number, x1: number): [number, number, number, number] =>
    [Math.round((y0 / H) * 1000), Math.round((x0 / W) * 1000), Math.round((y1 / H) * 1000), Math.round((x1 / W) * 1000)];
  /** 균일한 회색 바탕에 검은 막대(가짜 글자)들을 그린 RGBA */
  const canvas = (bars: { y0: number; y1: number; x0: number; x1: number }[]) => {
    const a = new Uint8Array(W * H * 4).fill(200);
    for (let i = 0; i < W * H; i++) a[i * 4 + 3] = 255;
    for (const b of bars) for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
      const i = (y * W + x) * 4; a[i] = 20; a[i + 1] = 20; a[i + 2] = 20;
    }
    return a;
  };
  const target: OcrBox = { box: nb(42, 52, 68, 128), zh: "强震", ko: "강력 진동", bg: "#fff", fg: "#000", solid_bg: true };
  const origBar = { y0: 45, y1: 65, x0: 55, x1: 125 }; // 20px 높이
  const smallBar = { y0: 49, y1: 61, x0: 60, x1: 120 }; // 12px 높이 = 60%

  it("같은 크기로 그려지면 비율 1", () => {
    const r = bandGlyphShrink(canvas([origBar]), canvas([origBar]), W, H, [target], [target], band);
    expect(r).toHaveLength(1);
    expect(r[0].zh).toBe("强震");
    expect(r[0].ratio).toBeCloseTo(1, 1);
  });

  it("높이가 60% 로 줄면 비율 0.6 — 재시도 사유가 된다", () => {
    expect(bandGlyphShrink(canvas([origBar]), canvas([smallBar]), W, H, [target], [target], band)[0].ratio).toBeCloseTo(0.6, 1);
  });

  it("여백에 걸친 이웃 문구의 획은 세지 않는다 — 세면 줄어든 것이 가려진다", () => {
    const neighbor: OcrBox = { ...target, box: nb(70, 52, 90, 128), zh: "温热" };
    const nBar = { y0: 72, y1: 88, x0: 55, x1: 125 };
    const r = bandGlyphShrink(canvas([origBar, nBar]), canvas([smallBar, nBar]), W, H, [target], [target, neighbor], band);
    expect(r[0].ratio).toBeCloseTo(0.6, 1);
  });

  it("원문에 잴 글자가 없으면 판정하지 않는다 — 단색 픽스처", () => {
    expect(bandGlyphShrink(canvas([]), canvas([]), W, H, [target], [target], band)).toEqual([]);
  });

  it("결과에 글자가 안 보이면 판정하지 않는다 — 글자 유무는 판독 관문의 몫", () => {
    expect(bandGlyphShrink(canvas([origBar]), canvas([]), W, H, [target], [target], band)).toEqual([]);
  });

  it("사진 배경(solid_bg=false) 문구는 재지 않는다 — 중앙값 배경이 성립하지 않는다", () => {
    const photo = { ...target, solid_bg: false };
    expect(bandGlyphShrink(canvas([origBar]), canvas([smallBar]), W, H, [photo], [photo], band)).toEqual([]);
  });
});

describe("compositeBand", () => {
  it("띠 픽셀을 원본 위 그 자리에 얹는다 — 알파 0 은 원본 그대로, 원본은 안 바뀐다", () => {
    const W = 10, H = 10;
    const orig = new Uint8Array(W * H * 4).fill(100);
    const band = { left: 2, top: 3, width: 4, height: 2 };
    const p = Buffer.alloc(band.width * band.height * 4);
    for (let i = 0; i < band.width * band.height; i++) {
      p[i * 4] = 250; p[i * 4 + 1] = 250; p[i * 4 + 2] = 250; p[i * 4 + 3] = i === 0 ? 0 : 255;
    }
    const c = compositeBand(orig, p, band, W, H);
    expect(c[(3 * W + 2) * 4]).toBe(100); // 알파 0 → 원본
    expect(c[(3 * W + 3) * 4]).toBe(250);
    expect(c[(5 * W + 3) * 4]).toBe(100); // 띠 밖
    expect(orig[(3 * W + 3) * 4]).toBe(100);
  });
});

describe("buildBandQualityPrompt — 띠 육안 심사", () => {
  it("있어야 할 문구가 빠진 것도 hard 다 — 지운 채 비워 둔 띠는 잔류·헛글자 검사를 다 통과한다", () => {
    const q = buildBandQualityPrompt(["강력한 신축"]);
    const hard = q.slice(q.indexOf("hard"), q.indexOf("무시할 것"));
    expect(hard).toMatch(/빠졌|누락|비어/);
  });
});

describe("keptOriginalDetail — 원문 유지 사유 표기", () => {
  it("사유를 자르지 않는다 — 실측(마리아 0018): 항목을 14자에서 잘라 사유가 빈 채로 보고됐다", () => {
    const d = keptOriginalDetail([
      "回弹设计 满足多样姿势 — 이음매가 보입니다",
      "大头爆震 更大更刺激 — 이미지 호출 한도",
    ]);
    expect(d).toContain("이음매가 보입니다");
    expect(d).toContain("이미지 호출 한도");
  });
  it("전체 길이는 300자 안에서 끊는다", () => {
    const d = keptOriginalDetail(Array.from({ length: 40 }, (_, i) => `문구${i} — 움직이는 화면 위`));
    expect(d.length).toBeLessThanOrEqual(300);
  });
});

/**
 * 띠 기준 길이 예산 — 박스가 아니라 **정지 여백까지 넓힌 띠**에 실제로 들어가는 글자 수.
 * 실측(2026-09-02 exp10): 「人体进阶」 박스 기준 예산 6자 → "인체 마스터"(어색). 실제
 * 띠는 589px 로 넓어져 "인체공학 설계"(7자)가 원래 크기로 들어갈 자리였다. 반대로
 * 「多种频率」는 여백이 없어 4자("진동모드")가 진실이다.
 */
describe("gifCharBudget — 띠에 실제로 들어가는 글자 수", () => {
  it("폭 ÷ (0.85 × 글자 높이) — 공백 포함 한국어 한 글자 평균 0.85em", () => {
    expect(gifCharBudget(113, 30, 4)).toBe(4); // 「多种频率」 자리 그대로 → "진동모드"
    expect(gifCharBudget(174, 30, 4)).toBe(6); // 정지 여백으로 넓힌 띠 → "다양한 진동"
    expect(gifCharBudget(589, 95, 4)).toBe(7); // 「人体进阶」 제목 띠 → "인체공학 설계"
  });
  it("아무리 좁아도 4자 — 그 밑으론 뜻을 담을 수 없다", () => {
    expect(gifCharBudget(20, 30, 4)).toBe(4);
  });
});

describe("staticRoomOf — 문구 좌우로 넓힐 수 있는 정지 여백", () => {
  it("움직이는 쪽은 막히고, 다른 문구 앞에서 멈춘다", () => {
    const f0 = frame();
    const f1 = move(f0, 0, 0, 50, 200); // x<50 움직임
    const moved = movedMaskFromFrames([f0, f1], W, H);
    const core = { x0: 60, y0: 90, x1: 100, y1: 110 };
    const r = staticRoomOf(moved, W, H, core, [{ x0: 150, y0: 85, x1: 190, y1: 115 }], 80);
    expect(r.left).toBe(10); // x50 까지
    expect(r.right).toBe(48); // 이웃(150) 앞 2px 까지
  });
  it("상한을 넘지 않는다", () => {
    const moved = new Uint8Array(W * H);
    const r = staticRoomOf(moved, W, H, { x0: 100, y0: 90, x1: 120, y1: 110 }, [], 30);
    expect(r).toEqual({ left: 30, right: 30 });
  });
});

describe("bandGlyphColorShift — 글자색이 원본과 달라졌나 (픽셀, 호출 0회)", () => {
  const W = 200, H = 120;
  const band = { left: 40, top: 30, width: 100, height: 50 };
  const nb = (y0: number, x0: number, y1: number, x1: number): [number, number, number, number] =>
    [Math.round((y0 / H) * 1000), Math.round((x0 / W) * 1000), Math.round((y1 / H) * 1000), Math.round((x1 / W) * 1000)];
  const canvas = (bars: { y0: number; y1: number; x0: number; x1: number; rgb: [number, number, number] }[]) => {
    const a = new Uint8Array(W * H * 4).fill(235);
    for (let i = 0; i < W * H; i++) a[i * 4 + 3] = 255;
    for (const b of bars) for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
      const i = (y * W + x) * 4; a[i] = b.rgb[0]; a[i + 1] = b.rgb[1]; a[i + 2] = b.rgb[2];
    }
    return a;
  };
  const target: OcrBox = { box: nb(42, 52, 68, 128), zh: "强震", ko: "강력 진동", bg: "#fff", fg: "#000", solid_bg: true };
  const red = { y0: 45, y1: 65, x0: 55, x1: 125, rgb: [210, 30, 30] as [number, number, number] };
  const black = { ...red, rgb: [20, 20, 20] as [number, number, number] };

  it("빨간 제목이 검정으로 바뀌면 잡는다 — 지금까지는 어떤 관문도 색을 보지 않았다", () => {
    const r = bandGlyphColorShift(canvas([red]), canvas([black]), W, H, [target], [target], band);
    expect(r).toHaveLength(1);
    expect(r[0].zh).toBe("强震");
    expect(r[0].delta).toBeGreaterThan(100);
  });

  it("같은 색이면 차이 0 근처", () => {
    const r = bandGlyphColorShift(canvas([red]), canvas([red]), W, H, [target], [target], band);
    expect(r[0].delta).toBeLessThan(10);
  });

  it("글자가 없는 곳은 판정하지 않는다", () => {
    expect(bandGlyphColorShift(canvas([]), canvas([]), W, H, [target], [target], band)).toEqual([]);
  });
});
