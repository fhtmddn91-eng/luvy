/**
 * 안전필터 거부 시 국소 편집 폴백의 순수 함수 검증.
 *
 * 지켜야 하는 것:
 *  1. 띠는 박스 주변 패딩을 포함하되 이미지 밖으로 나가지 않는다
 *  2. 패딩 후 겹치는 박스들은 한 띠로 합쳐진다 (같은 배경을 두 번 편집하면
 *     이음새가 두 배로 생긴다)
 *  3. 좌표 재매핑은 원본 정규화 좌표 ↔ 띠 내부 정규화 좌표를 정확히 오간다 —
 *     어긋나면 글자가 띠 밖에 그려져 합성 후 위치가 틀어진다
 */
import { describe, it, expect } from "vitest";
import { clusterBands, remapBoxToBand, findLeftoverZh, type OcrBox } from "./imageTranslate";

const box = (b: [number, number, number, number]): OcrBox => ({
  box: b, zh: "测试", ko: "테스트", bg: "#fff", fg: "#000",
});

describe("clusterBands — 띠 묶기", () => {
  it("떨어진 박스는 각자 띠가 되고 패딩이 붙는다", () => {
    const bands = clusterBands([box([100, 100, 200, 300]), box([700, 600, 800, 900])], 1000, 1000);
    expect(bands).toHaveLength(2);
    // 첫 박스: y 100~200‰, x 100~300‰ + 패딩 60‰
    expect(bands[0].top).toBe(40);
    expect(bands[0].left).toBe(40);
    expect(bands[0].top + bands[0].height).toBe(260);
    expect(bands[0].left + bands[0].width).toBe(360);
  });

  it("이미지 경계를 벗어나지 않는다", () => {
    const [b] = clusterBands([box([10, 10, 990, 990])], 800, 600);
    expect(b.left).toBe(0);
    expect(b.top).toBe(0);
    expect(b.width).toBe(800);
    expect(b.height).toBe(600);
  });

  it("패딩 후 겹치는 박스는 한 띠로 합친다", () => {
    const bands = clusterBands(
      [box([100, 100, 200, 400]), box([220, 100, 320, 400])], // 세로로 20‰ 간격 — 패딩 60‰씩이라 겹침
      1000, 1000,
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].top).toBe(40);
    expect(bands[0].top + bands[0].height).toBe(380);
  });

  it("빈 입력은 빈 배열", () => {
    expect(clusterBands([], 1000, 1000)).toEqual([]);
  });
});

describe("remapBoxToBand — 좌표 재매핑", () => {
  it("원본 정규화 좌표를 띠 내부 정규화 좌표로 옮긴다", () => {
    // 1000×1000 이미지의 띠 (left 250, top 50, 500×200) 안 중앙 박스
    const band = { left: 250, top: 50, width: 500, height: 200 };
    const b = remapBoxToBand(box([100, 400, 200, 600]), band, 1000, 1000);
    // y: (100-50)/200=25% → 250‰, (200-50)/200 → 750‰
    // x: (400-250)/500=30% → 300‰, (600-250)/500 → 700‰
    expect(b.box).toEqual([250, 300, 750, 700]);
  });

  it("문구·색 등 나머지 필드는 그대로 유지한다", () => {
    const band = { left: 0, top: 0, width: 1000, height: 1000 };
    const src = { ...box([0, 0, 1000, 1000]), bold: true, scale: 1.2 };
    const out = remapBoxToBand(src, band, 1000, 1000);
    expect(out.ko).toBe("테스트");
    expect(out.bold).toBe(true);
    expect(out.scale).toBe(1.2);
  });
});

describe("findLeftoverZh — 띠 패치의 원문 잔존 검사", () => {
  // 실사례(2026-08-30 합환토): 띠 재생성이 제목 둘째 줄(转着戳)을 로고로 착각해
  // 그대로 두었는데, 검사 없이 채택해 잔존 후보가 검수함까지 올라갔다.
  const t = (zh: string, ko = "번역"): OcrBox => ({ box: [0, 0, 100, 100], zh, ko, bg: "#fff", fg: "#000" });

  it("판독문에 대상 원문이 그대로 있으면 잡는다 — 띄어쓰기가 달라도", () => {
    expect(findLeftoverZh(["밀착 입", "转着 戳"], [t("夹住吸"), t("转着戳")])).toEqual(["转着戳"]);
  });

  it("교체가 끝난 띠는 빈 배열", () => {
    expect(findLeftoverZh(["밀착 흡입", "분리형 컨트롤"], [t("夹住吸"), t("分体控制")])).toEqual([]);
  });

  it("보존 대상(로고·keep) 원문은 남아 있어도 잔존이 아니다", () => {
    const keep: OcrBox = { ...t("次日达"), mode: "keep" };
    expect(findLeftoverZh(["밀착 흡입", "次日达"], [t("夹住吸"), keep])).toEqual([]);
  });

  it("지움(erase) 대상이 남아 있으면 잔존이다", () => {
    const erase: OcrBox = { ...t("水印水印"), mode: "erase" };
    expect(findLeftoverZh(["水印水印"], [erase])).toEqual(["水印水印"]);
  });
});
