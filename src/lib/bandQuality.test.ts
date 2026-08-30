/**
 * 국소 폴백 산출물의 육안 하자 3종 방지 (2026-08-31 운영 신고).
 *
 *  1. 텍스트 겹침 — 겹쳐 인쇄된 원본에서 모델이 그린 글자 위에 로컬 글자를
 *     또 얹어 두 층이 섞였다(실사례: 액상 「밀착 핥기」 위 「쾌감의 맥박」)
 *  2. 흰색 일그러짐 — 로컬 지우개가 사진·그라데이션 배경을 못 메꿔 뿌연
 *     사각형이 남는다(이 코드베이스에 이미 기록된 로컬 렌더의 물리적 한계)
 *  3. 띠 경계 위화감 — 패치를 각지게 붙여 이음선이 보인다
 */
import { describe, it, expect } from "vitest";
import {
  groupOverlappingBoxes,
  canLocalOverlay,
  applyEdgeFeather,
  type OcrBox,
} from "./imageTranslate";

const box = (b: [number, number, number, number], over: Partial<OcrBox> = {}): OcrBox => ({
  box: b, zh: "强震", ko: "진동", bg: "#fff", fg: "#000", ...over,
});

describe("groupOverlappingBoxes — 겹쳐 인쇄된 문구 묶기", () => {
  it("겹치는 박스는 한 그룹, 떨어진 박스는 각자 그룹", () => {
    const a = box([100, 100, 200, 400]);
    const b = box([150, 200, 250, 500]); // a 와 겹침
    const c = box([700, 700, 800, 900]); // 멀리 떨어짐
    const groups = groupOverlappingBoxes([a, b, c]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.length === 2)).toBeDefined();
    expect(groups.find((g) => g.length === 1)?.[0]).toBe(c);
  });

  it("A-B, B-C 로 이어지면 셋이 한 그룹 (연쇄)", () => {
    const groups = groupOverlappingBoxes([
      box([100, 100, 200, 300]),
      box([150, 250, 250, 450]),
      box([200, 400, 300, 600]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("모서리만 스치는 경우는 겹침이 아니다", () => {
    const groups = groupOverlappingBoxes([box([100, 100, 200, 200]), box([200, 200, 300, 300])]);
    expect(groups).toHaveLength(2);
  });

  it("빈 입력은 빈 배열", () => {
    expect(groupOverlappingBoxes([])).toEqual([]);
  });
});

describe("canLocalOverlay — 사진 배경에는 로컬 덮기 금지", () => {
  it("단색 배경(배지·띠)만 허용한다", () => {
    expect(canLocalOverlay(box([0, 0, 100, 100], { solid_bg: true }))).toBe(true);
  });

  it("사진·그라데이션 배경은 금지 — 흰 뭉개짐이 남는다", () => {
    expect(canLocalOverlay(box([0, 0, 100, 100], { solid_bg: false }))).toBe(false);
  });

  it("판정이 없으면 허용 — OCR 이 불명확하면 단색 취급하는 기존 규약과 일치", () => {
    expect(canLocalOverlay(box([0, 0, 100, 100]))).toBe(true);
  });
});

describe("applyEdgeFeather — 띠 경계 부드럽게", () => {
  /** 4채널 RGBA, 알파는 전부 255로 시작 */
  const rgba = (w: number, h: number) => {
    const b = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) b[i * 4 + 3] = 255;
    return b;
  };
  const alphaAt = (b: Buffer, w: number, x: number, y: number) => b[(y * w + x) * 4 + 3];

  it("가장자리 알파를 낮추고 안쪽은 불투명하게 둔다", () => {
    const w = 20, h = 20;
    const b = applyEdgeFeather(rgba(w, h), w, h, 4, { left: true, top: true, right: true, bottom: true });
    expect(alphaAt(b, w, 0, 10)).toBeLessThan(alphaAt(b, w, 3, 10));
    expect(alphaAt(b, w, 10, 10)).toBe(255); // 한가운데는 그대로
  });

  it("이미지 경계에 닿은 면은 페더하지 않는다 — 그쪽엔 이음선이 없다", () => {
    const w = 20, h = 20;
    const b = applyEdgeFeather(rgba(w, h), w, h, 4, { left: false, top: true, right: true, bottom: true });
    expect(alphaAt(b, w, 0, 10)).toBe(255); // 왼쪽 끝은 불투명 유지
    expect(alphaAt(b, w, 19, 10)).toBeLessThan(255); // 오른쪽은 페더
  });

  it("feather 가 0이면 아무것도 바꾸지 않는다", () => {
    const w = 8, h = 8;
    const b = applyEdgeFeather(rgba(w, h), w, h, 0, { left: true, top: true, right: true, bottom: true });
    expect(alphaAt(b, w, 0, 0)).toBe(255);
  });
});
