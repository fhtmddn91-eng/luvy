/**
 * GIF 정지 띠 선별 — 2026-08-31 전환의 핵심 판정.
 *
 * 실사례(H007): 글자 4개가 전 프레임 완전 정지인데도 옛 좌표 패치 관문에
 * 걸려 "GIF 정지 패치 실패"로 떨어졌다. 이제 띠 단위로 정지를 보고,
 * 띠가 움직이면 붙어 있던 이웃 때문에 통째로 버리지 않고 박스별로 다시 본다.
 */
import { describe, it, expect } from "vitest";
import { staticBandsOf, type OcrBox } from "./imageTranslate";

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
