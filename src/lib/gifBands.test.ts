/**
 * GIF 정지 띠 선별 — 2026-08-31 전환의 핵심 판정.
 *
 * 실사례(H007): 글자 4개가 전 프레임 완전 정지인데도 옛 좌표 패치 관문에
 * 걸려 "GIF 정지 패치 실패"로 떨어졌다. 이제 띠 단위로 정지를 보고,
 * 띠가 움직이면 붙어 있던 이웃 때문에 통째로 버리지 않고 박스별로 다시 본다.
 */
import { describe, it, expect } from "vitest";
import { bandRegenPrompt, bandRetryHint, bandSeamProblem, resolveBandOverlaps, seamSidesOf, staticBandsOf, type OcrBox } from "./imageTranslate";

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
    const groups = staticBandsOf([box([100, 100, 150, 400]), box([170, 100, 220, 400])], raws, W, H);
    expect(groups).toHaveLength(1);
    expect(groups[0].boxes).toHaveLength(2);
  });

  it("띠 안에 움직이는 부분이 있으면 그 띠는 통째로 쓰지 않는다", () => {
    // 두 박스 사이 여백(픽셀 y 32~40)에 애니메이션 — 띠로 묶으면 얼어붙는다
    const f0 = frame();
    const raws = [f0, move(f0, 0, 32, W, 40)];
    const groups = staticBandsOf([box([100, 100, 150, 400]), box([220, 100, 270, 400])], raws, W, H);
    // 띠는 탈락하고, 박스별로 다시 봐도 그 여백을 물면 함께 탈락한다
    expect(groups.every((g) => g.boxes.length === 1)).toBe(true);
  });

  it("한 박스만 움직이면 나머지는 살린다 — 통째로 버리지 않는다", () => {
    const f0 = frame();
    // 아래쪽 박스 자리(픽셀 y 160~180)만 움직인다
    const raws = [f0, move(f0, 20, 160, 100, 180)];
    const groups = staticBandsOf([box([100, 100, 150, 400], "위"), box([820, 100, 890, 480], "아래")], raws, W, H);
    const kept = groups.flatMap((g) => g.boxes.map((b) => b.zh));
    expect(kept).toContain("위");
    expect(kept).not.toContain("아래");
  });

  it("글자가 전부 움직이는 화면 위면 빈 배열 — 얼려붙이지 않는다", () => {
    const f0 = frame();
    const raws = [f0, move(f0, 0, 0, W, H)];
    expect(staticBandsOf([box([100, 100, 150, 400])], raws, W, H)).toEqual([]);
  });

  it("띠 안이 조금이라도 움직이면 통과시키지 않는다 — 1%도 얼어붙는다", () => {
    // 실측(gifB): 기본 허용치 1% 로 통과한 띠가 그 영역 움직임을 13.7%→5.4% 로 얼렸다
    const f0 = frame();
    const raws = [f0, move(f0, 60, 60, 68, 68)]; // 8x8px = 띠의 1% 미만
    expect(staticBandsOf([box([250, 250, 350, 700])], raws, W, H)).toEqual([]);
  });

  it("흩어진 정지 띠는 사이가 정지면 하나로 합친다 — 호출 1회로 전부 번역", () => {
    const raws = [frame(), frame()];
    const groups = staticBandsOf([box([60, 100, 90, 400], "위"), box([800, 100, 830, 400], "아래")], raws, W, H);
    expect(groups).toHaveLength(1);
    expect(groups[0].boxes).toHaveLength(2);
  });

  it("띠 사이가 움직이면 합치지 않는다 — 그 사이가 얼어붙는다", () => {
    const f0 = frame();
    const raws = [f0, move(f0, 0, 100, W, 130)]; // 두 띠 사이 가로 줄이 움직임
    const groups = staticBandsOf([box([60, 100, 90, 400], "위"), box([800, 100, 830, 400], "아래")], raws, W, H);
    expect(groups.length).toBeGreaterThan(1);
  });

  it("글자를 많이 담은 띠가 먼저 온다 — 호출 1회를 가장 값진 띠에 쓴다", () => {
    const raws = [frame(), frame()];
    const groups = staticBandsOf(
      [box([60, 100, 90, 400], "혼자"), box([500, 100, 530, 400], "둘1"), box([560, 100, 590, 400], "둘2")],
      raws, W, H,
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

  it("커버 검사가 재는 '띠 밖으로 넘치지 말 것'과 축소 허용을 지시한다", () => {
    expect(p).toMatch(/글자 크기를 조금 줄여/);
    expect(p).toMatch(/띠 밖으로 넘치거나 잘리면 실패/);
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
  it("모르는 사유는 그대로 전달한다 — 삼키지 않는다", () => {
    expect(bandRetryHint("알 수 없는 사유 XYZ")).toContain("알 수 없는 사유 XYZ");
  });
});
