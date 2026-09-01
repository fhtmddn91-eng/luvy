/**
 * GIF 정지 띠 선별 — 2026-08-31 전환의 핵심 판정.
 *
 * 실사례(H007): 글자 4개가 전 프레임 완전 정지인데도 옛 좌표 패치 관문에
 * 걸려 "GIF 정지 패치 실패"로 떨어졌다. 이제 띠 단위로 정지를 보고,
 * 띠가 움직이면 붙어 있던 이웃 때문에 통째로 버리지 않고 박스별로 다시 본다.
 */
import { describe, it, expect } from "vitest";
import { resolveBandOverlaps, seamSidesOf, staticBandsOf, type OcrBox } from "./imageTranslate";

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
