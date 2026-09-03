/**
 * 승인 문구 기억 — 「다시 만들기」와 같은 상품의 다른 그림이 사람이 승인한 번역을 출발점으로 쓴다.
 * 실측(2026-09-02): VERIFIED 문구 "인체공학 설계"가 있는데 재렌더가 매번 처음부터 번역해
 * "인체 마스터"를 만들었다. 운영 DB 조사: 같은 상품 안에서 반복되는 문구 14%, 그중 승인본 있음 60건.
 */
import { describe, it, expect } from "vitest";
import { phraseMemoryFrom } from "./phraseMemory";

const row = (id: string, status: string | null, boxes: unknown[] | null, candidate: unknown[] | null = null) => ({
  id,
  translateStatus: status,
  ocrData: boxes ? JSON.stringify(boxes) : null,
  candidateOcr: candidate ? JSON.stringify(candidate) : null,
});

describe("phraseMemoryFrom", () => {
  it("자기 자신의 확정 문구(ocrData)를 우선 쓴다 — 재렌더의 출발점", () => {
    const m = phraseMemoryFrom(
      [
        row("me", "VERIFIED", [{ zh: "人体进阶", ko: "인체공학 설계", box: [0, 0, 1, 1] }]),
        row("sib", "VERIFIED", [{ zh: "人体进阶", ko: "인체 마스터", box: [0, 0, 1, 1] }]),
      ],
      "me",
    );
    expect(m.get("人体进阶")).toBe("인체공학 설계");
  });

  it("다른 그림은 VERIFIED 의 확정 문구만 — 후보(candidateOcr)·검수 대기 문구는 승인이 아니다", () => {
    const m = phraseMemoryFrom(
      [
        row("a", "NEEDS_REVIEW", null, [{ zh: "多种频率", ko: "다양한 진동 모드", box: [0, 0, 1, 1] }]),
        row("b", "VERIFIED", [{ zh: "防水设计", ko: "방수 설계", box: [0, 0, 1, 1] }]),
      ],
      "me",
    );
    expect(m.has("多种频率")).toBe(false);
    expect(m.get("防水设计")).toBe("방수 설계");
  });

  it("보존(keep)·지움·한자 남은 번역·원문 그대로는 기억하지 않는다", () => {
    const m = phraseMemoryFrom(
      [
        row("me", "VERIFIED", [
          { zh: "A", ko: "", box: [0, 0, 1, 1], mode: "keep" },
          { zh: "B", ko: "", box: [0, 0, 1, 1], mode: "erase" },
          { zh: "C", ko: "伸縮 기능", box: [0, 0, 1, 1] },
          { zh: "D", ko: "D", box: [0, 0, 1, 1] },
        ]),
      ],
      "me",
    );
    expect(m.size).toBe(0);
  });

  it("깨진 JSON 은 건너뛴다", () => {
    const m = phraseMemoryFrom([{ id: "x", translateStatus: "VERIFIED", ocrData: "{not json", candidateOcr: null }], "me");
    expect(m.size).toBe(0);
  });
});
