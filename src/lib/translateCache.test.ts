/**
 * 해시 캐시 계약 — 같은 (바이트, 파이프라인 버전)은 재실행하지 않고,
 * 끊어진 캐시(파일 소실·손상)는 적중 처리하지 않는다 (설계 v2.1 정책 7·8).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface CacheRow {
  sha256: string;
  pipelineVersion: string;
  status: string;
  ocrData: string | null;
  resultFile: string | null;
  verifyData: string | null;
  staleAt: Date | null;
  staleReason: string | null;
}
const rows = new Map<string, CacheRow>();
const files = new Map<string, { name: string; mime: string; bytes: number; data: Buffer }>();
const key = (sha: string, pv: string) => `${sha}|${pv}`;

vi.mock("@/lib/db", () => ({
  db: {
    translationCache: {
      findUnique: async ({ where, include }: { where: { sha256_pipelineVersion: { sha256: string; pipelineVersion: string } }; include?: { storedFile?: boolean } }) => {
        const row = rows.get(key(where.sha256_pipelineVersion.sha256, where.sha256_pipelineVersion.pipelineVersion));
        if (!row) return null;
        return {
          ...row,
          ...(include?.storedFile ? { storedFile: row.resultFile ? files.get(row.resultFile) ?? null : null } : {}),
        };
      },
      updateMany: async ({ where, data }: { where: { sha256: string; pipelineVersion: string }; data: Partial<CacheRow> }) => {
        const row = rows.get(key(where.sha256, where.pipelineVersion));
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
      upsert: async ({ where, create, update }: { where: { sha256_pipelineVersion: { sha256: string; pipelineVersion: string } }; create: CacheRow; update: Partial<CacheRow> }) => {
        const k = key(where.sha256_pipelineVersion.sha256, where.sha256_pipelineVersion.pipelineVersion);
        const row = rows.get(k);
        if (row) Object.assign(row, update);
        else rows.set(k, { ...create });
      },
    },
  },
}));

const { sha256Of, lookupTranslationCache, saveTranslationCache, PIPELINE_VERSION } = await import("./translateCache");

const putFile = (name: string, data: Buffer, bytes = data.byteLength) =>
  files.set(name, { name, mime: "image/jpeg", bytes, data });

beforeEach(() => {
  rows.clear();
  files.clear();
});

describe("translateCache", () => {
  it("sha256Of — 같은 바이트는 같은 키, 다른 바이트는 다른 키", () => {
    expect(sha256Of(Buffer.from("a"))).toBe(sha256Of(Buffer.from("a")));
    expect(sha256Of(Buffer.from("a"))).not.toBe(sha256Of(Buffer.from("b")));
  });

  it("VERIFIED 저장 → 같은 키 조회는 파일까지 온전한 적중", async () => {
    putFile("t1.jpg", Buffer.from("translated-bytes"));
    await saveTranslationCache({ sha256: "s1", status: "VERIFIED", ocrData: "[]", resultFile: "t1.jpg" });
    const hit = await lookupTranslationCache("s1");
    expect(hit?.kind).toBe("verified");
    if (hit?.kind === "verified") {
      expect(hit.data.toString()).toBe("translated-bytes");
      expect(hit.resultFile).toBe("t1.jpg");
    }
  });

  it("pipelineVersion 이 다르면 구버전 VERIFIED 라도 미스 — 자동 재사용 금지", async () => {
    putFile("t1.jpg", Buffer.from("x"));
    rows.set(key("s1", "old-model|prompt:1|patch:1|verify:1"), {
      sha256: "s1", pipelineVersion: "old-model|prompt:1|patch:1|verify:1",
      status: "VERIFIED", ocrData: null, resultFile: "t1.jpg", verifyData: null, staleAt: null, staleReason: null,
    });
    expect(await lookupTranslationCache("s1")).toBeNull();
    // 구버전 행은 보존된다
    expect(rows.size).toBe(1);
  });

  it("NEEDS_REVIEW 캐시는 blocked — 자동 재실행 금지 신호", async () => {
    await saveTranslationCache({ sha256: "s2", status: "NEEDS_REVIEW", verifyData: "[{\"code\":\"LEFTOVER\"}]" });
    const hit = await lookupTranslationCache("s2");
    expect(hit?.kind).toBe("blocked");
    if (hit?.kind === "blocked") expect(hit.status).toBe("NEEDS_REVIEW");
  });

  it("파일 소실: 적중 아님 + stale 표시", async () => {
    await saveTranslationCache({ sha256: "s3", status: "VERIFIED", resultFile: "gone.jpg" });
    expect(await lookupTranslationCache("s3")).toBeNull();
    expect(rows.get(key("s3", PIPELINE_VERSION))?.staleAt).not.toBeNull();
    expect(rows.get(key("s3", PIPELINE_VERSION))?.staleReason).toContain("소실");
  });

  it("파일 손상(bytes 불일치): 적중 아님 + stale 표시", async () => {
    putFile("t4.jpg", Buffer.from("abc"), 999);
    await saveTranslationCache({ sha256: "s4", status: "VERIFIED", resultFile: "t4.jpg" });
    expect(await lookupTranslationCache("s4")).toBeNull();
    expect(rows.get(key("s4", PIPELINE_VERSION))?.staleReason).toContain("손상");
  });

  it("stale 행은 다시 적중하지 않는다", async () => {
    putFile("t5.jpg", Buffer.from("ok"));
    await saveTranslationCache({ sha256: "s5", status: "VERIFIED", resultFile: "t5.jpg" });
    rows.get(key("s5", PIPELINE_VERSION))!.staleAt = new Date();
    expect(await lookupTranslationCache("s5")).toBeNull();
  });

  it("재저장(운영자 승인 재렌더)은 같은 키를 덮어쓰고 stale 을 푼다", async () => {
    await saveTranslationCache({ sha256: "s6", status: "FAILED", verifyData: "x" });
    rows.get(key("s6", PIPELINE_VERSION))!.staleAt = new Date();
    putFile("t6.jpg", Buffer.from("new"));
    await saveTranslationCache({ sha256: "s6", status: "VERIFIED", resultFile: "t6.jpg" });
    const hit = await lookupTranslationCache("s6");
    expect(hit?.kind).toBe("verified");
  });
});
