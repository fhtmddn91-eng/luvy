import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./mirror", () => ({ mirrorImages: async () => ({ images: [], failures: [] }) }));
vi.mock("./translate", () => ({ translateDraft: async () => ({}) }));

import { buildAssetRows } from "./pipeline";

const img = (n: string) => ({ url: `/uploads/${n}`, bytes: 1000 });

describe("buildAssetRows — 수집 이미지 순서", () => {
  it("종류를 가로질러 하나의 연속 번호를 매긴다 (순서 뒤섞임 방지)", () => {
    // 예전 버그: 대표·상세·옵션이 각각 0부터 시작해 번호가 겹쳤고,
    // 1688 에서 1,2,3,4,5 순이던 이미지가 1,4,3,2,5 로 보였다
    const rows = buildAssetRows(
      [img("m1.jpg"), img("m2.jpg")],
      [img("d1.jpg"), img("d2.jpg")],
      [img("o1.jpg")],
    );
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(rows.map((r) => r.sortOrder)).size).toBe(rows.length); // 중복 없음
  });

  it("대표 → 상세 → 옵션 순으로 원본 순서를 보존한다", () => {
    const rows = buildAssetRows([img("m1.jpg")], [img("d1.jpg")], [img("o1.jpg")]);
    expect(rows.map((r) => [r.kind, r.url.split("/").pop()])).toEqual([
      ["MAIN", "m1.jpg"],
      ["DETAIL", "d1.jpg"],
      ["OPTION", "o1.jpg"],
    ]);
  });

  it("상세 이미지 중 GIF 는 kind 를 GIF 로 구분한다", () => {
    const rows = buildAssetRows([], [img("a.jpg"), img("b.gif")], []);
    expect(rows.map((r) => r.kind)).toEqual(["DETAIL", "GIF"]);
  });

  it("대표 이미지가 gif 여도 kind 는 MAIN 을 유지한다 (썸네일 자리)", () => {
    const rows = buildAssetRows([img("m.gif")], [], []);
    expect(rows[0].kind).toBe("MAIN");
  });

  it("빈 목록도 안전하게 처리한다", () => {
    expect(buildAssetRows([], [], [])).toEqual([]);
  });
});
