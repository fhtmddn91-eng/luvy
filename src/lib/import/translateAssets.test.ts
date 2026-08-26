/**
 * 저장 규칙·게이트 통합 검증 (DB·스토리지·모델 전부 목):
 * - VERIFIED 만 손님용 url 로 나간다 — 후보·로컬 결과가 url 로 유입되는 길이 없다
 * - 캐시 적중·판정 캐시는 모델을 다시 부르지 않는다
 * - VERIFIED 아닌 모든 상태는 상품 ACTIVE 승격을 막는다
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/* ── 인메모리 DB ── */
interface AssetRow {
  id: string;
  productId: string;
  url: string;
  originalUrl: string | null;
  ocrData: string | null;
  bytes: number;
  translateStatus: string | null;
  reviewReasons: string | null;
  candidateUrl: string | null;
  candidateOcr: string | null;
  originalSha256: string | null;
  sortOrder: number;
}
interface ProductRow {
  id: string;
  status: string;
  publishRequestedAt: Date | null;
  sourceUrl: string;
  image: string;
  brand: string;
}
const assets = new Map<string, AssetRow>();
const products = new Map<string, ProductRow>();

const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === "NOT") return !matches(row, v as Record<string, unknown>);
    if (v !== null && typeof v === "object") return false;
    return row[k] === v;
  });

vi.mock("@/lib/db", () => ({
  db: {
    productAsset: {
      update: async ({ where, data }: { where: { id: string }; data: Partial<AssetRow> }) => {
        const row = assets.get(where.id);
        if (!row) throw new Error("no asset");
        Object.assign(row, data);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        for (const row of assets.values()) if (matches(row as unknown as Record<string, unknown>, where)) return row;
        return null;
      },
      findMany: async ({ where }: { where: { productId: string } }) =>
        [...assets.values()].filter((a) => a.productId === where.productId).sort((a, b) => a.sortOrder - b.sortOrder),
    },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<ProductRow> }) => {
        const row = products.get(where.id);
        if (!row) throw new Error("no product");
        Object.assign(row, data);
        return row;
      },
    },
  },
}));

/* ── 스토리지 목 — 저장된 파일명을 추적 ── */
const savedFiles: string[] = [];
vi.mock("@/lib/storage", () => ({
  readPublicUpload: async (name: string) =>
    name.includes("missing") ? null : { data: Buffer.from(`bytes-of-${name}`), contentType: "image/jpeg" },
  saveImageBuffer: async (data: Buffer) => {
    const name = `saved-${savedFiles.length}.jpg`;
    savedFiles.push(name);
    return { ok: true as const, url: `/uploads/${name}` };
  },
  deleteUploadIfUnused: async () => {},
}));

/* ── 모델·캐시 목 ── */
const autoMock = vi.fn();
vi.mock("@/lib/imageTranslate", () => ({
  translateImageAuto: (...args: unknown[]) => autoMock(...args),
  IMAGE_MODEL: "test-image-model",
}));
const cacheLookup = vi.fn(async () => null as unknown);
const cacheSave = vi.fn(async () => {});
vi.mock("@/lib/translateCache", () => ({
  sha256Of: (b: Buffer) => `sha-${b.toString().slice(-20)}`,
  lookupTranslationCache: (...a: unknown[]) => cacheLookup(...(a as [])),
  saveTranslationCache: (...a: unknown[]) => cacheSave(...(a as [])),
  markCacheStale: async () => {},
}));
vi.mock("@/lib/import/sources", () => ({
  sourceForUrl: (url: string) => (url.includes("1688") ? { translate: true } : url ? { translate: false } : null),
}));

const { runAssetTranslation, promoteIfReady, translateProductImages } = await import("./translateAssets");

const BOXES = [{ box: [100, 100, 200, 900], zh: "强震", ko: "강력 진동", bg: "#fff", fg: "#000" }];

function seed(status: string | null = null, originalUrl: string | null = null): AssetRow {
  const row: AssetRow = {
    id: "a1", productId: "p1", url: "/uploads/orig-1.jpg", originalUrl,
    ocrData: null, bytes: 10, translateStatus: status, reviewReasons: null,
    candidateUrl: null, candidateOcr: null, originalSha256: null, sortOrder: 0,
  };
  assets.set(row.id, row);
  products.set("p1", { id: "p1", status: "HIDDEN", publishRequestedAt: null, sourceUrl: "https://detail.1688.com/x", image: "", brand: "루비" });
  return row;
}

beforeEach(() => {
  assets.clear();
  products.clear();
  savedFiles.length = 0;
  autoMock.mockReset();
  cacheLookup.mockReset();
  cacheLookup.mockResolvedValue(null);
  cacheSave.mockClear();
  process.env.GEMINI_API_KEY = "test";
});

describe("runAssetTranslation — 저장 규칙 (정책 9·10)", () => {
  it("VERIFIED 만 url 을 바꾼다", async () => {
    const a = seed();
    autoMock.mockResolvedValue({ status: "VERIFIED", data: Buffer.from("t"), mime: "image/jpeg", boxes: BOXES });
    const r = await runAssetTranslation(a);
    expect(r.result).toBe("verified");
    expect(a.url).toBe("/uploads/saved-0.jpg");
    expect(a.originalUrl).toBe("/uploads/orig-1.jpg");
    expect(a.translateStatus).toBe("VERIFIED");
    expect(cacheSave).toHaveBeenCalledWith(expect.objectContaining({ status: "VERIFIED" }));
  });

  it("NEEDS_REVIEW: url 은 원본 그대로, 후보는 candidateUrl 로만 — 검수 대기가 손님에게 가지 않는다", async () => {
    const a = seed();
    autoMock.mockResolvedValue({
      status: "NEEDS_REVIEW", data: Buffer.from("cand"), mime: "image/jpeg", boxes: BOXES,
      reasons: [{ code: "LEFTOVER", detail: "1건" }],
    });
    const r = await runAssetTranslation(a);
    expect(r.result).toBe("review");
    expect(a.url).toBe("/uploads/orig-1.jpg"); // 불변
    expect(a.candidateUrl).toBe("/uploads/saved-0.jpg");
    expect(a.translateStatus).toBe("NEEDS_REVIEW");
    expect(JSON.parse(a.reviewReasons!)[0].code).toBe("LEFTOVER");
  });

  it("후보 없는 NEEDS_REVIEW(안전필터 등): 파일 저장 없이 사유만", async () => {
    const a = seed();
    autoMock.mockResolvedValue({ status: "NEEDS_REVIEW", data: null, mime: null, boxes: BOXES, reasons: [{ code: "SAFETY_BLOCKED", detail: "x" }] });
    await runAssetTranslation(a);
    expect(a.url).toBe("/uploads/orig-1.jpg");
    expect(a.candidateUrl).toBeNull();
    expect(savedFiles).toHaveLength(0);
  });

  it("RETRYABLE: 상태·사유만 기록, url·파일 불변", async () => {
    const a = seed();
    autoMock.mockResolvedValue({ status: "RETRYABLE", reasons: [{ code: "TIMEOUT", detail: "90s" }] });
    const r = await runAssetTranslation(a);
    expect(r.result).toBe("retryable");
    expect(a.translateStatus).toBe("RETRYABLE");
    expect(a.url).toBe("/uploads/orig-1.jpg");
  });

  it("캐시 VERIFIED 적중: 모델 호출 0회, 캐시 파일로 연결", async () => {
    const a = seed();
    cacheLookup.mockResolvedValue({ kind: "verified", data: Buffer.from("cached"), mime: "image/jpeg", ocrData: "[]", resultFile: "cached-file.jpg" });
    const r = await runAssetTranslation(a);
    expect(r.result).toBe("verified");
    expect(autoMock).not.toHaveBeenCalled();
    expect(a.url).toBe("/uploads/cached-file.jpg");
  });

  it("판정 캐시(blocked) 적중: 자동 재실행 금지 — force 일 때만 실행", async () => {
    const a = seed();
    cacheLookup.mockResolvedValue({ kind: "blocked", status: "NEEDS_REVIEW", verifyData: "[]", ocrData: null, candidate: null });
    const r1 = await runAssetTranslation(a);
    expect(r1.result).toBe("review");
    expect(autoMock).not.toHaveBeenCalled();

    autoMock.mockResolvedValue({ status: "VERIFIED", data: Buffer.from("t"), mime: "image/jpeg", boxes: BOXES });
    const r2 = await runAssetTranslation(a, { force: true });
    expect(r2.result).toBe("verified");
    expect(autoMock).toHaveBeenCalledTimes(1);
  });

  it("원본 파일이 없으면 FAILED — 모델 호출 없음", async () => {
    const a = seed();
    a.url = "/uploads/missing.jpg";
    const r = await runAssetTranslation(a);
    expect(r.result).toBe("failed");
    expect(autoMock).not.toHaveBeenCalled();
  });
});

describe("promoteIfReady — ACTIVE 승격 게이트 (정책 9·10)", () => {
  it.each(["TRANSLATING", "NEEDS_REVIEW", "RETRYABLE", "VERIFICATION_FAILED", "FAILED"])(
    "%s 1장이 있으면 승격하지 않는다",
    async (status) => {
      seed("VERIFIED", "/uploads/o.jpg");
      const b: AssetRow = { ...assets.get("a1")!, id: "a2", translateStatus: status, sortOrder: 1 };
      assets.set("a2", b);
      products.get("p1")!.publishRequestedAt = new Date();
      expect(await promoteIfReady("p1")).toBe(false);
      expect(products.get("p1")!.status).toBe("HIDDEN");
    },
  );

  it("미번역(상태 null + 원본 그대로)도 승격을 막는다", async () => {
    seed(null, null);
    products.get("p1")!.publishRequestedAt = new Date();
    expect(await promoteIfReady("p1")).toBe(false);
  });

  it("전부 VERIFIED/NO_FOREIGN_TEXT 면 ACTIVE 로 승격하고 요청 표시를 비운다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    const b: AssetRow = { ...assets.get("a1")!, id: "a2", translateStatus: "NO_FOREIGN_TEXT", sortOrder: 1 };
    assets.set("a2", b);
    products.get("p1")!.publishRequestedAt = new Date();
    expect(await promoteIfReady("p1")).toBe(true);
    expect(products.get("p1")!.status).toBe("ACTIVE");
    expect(products.get("p1")!.publishRequestedAt).toBeNull();
  });

  it('브랜드가 "미정"이면 번역이 다 끝나도 승격하지 않는다 — 보류가 자동 승격으로 새면 안 된다', async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.publishRequestedAt = new Date();
    products.get("p1")!.brand = "미정"; // 수집 기본값 그대로
    expect(await promoteIfReady("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("HIDDEN");
    // 운영자가 실제 브랜드를 넣으면 그때 풀린다
    products.get("p1")!.brand = "루비";
    expect(await promoteIfReady("p1")).toBe(true);
    expect(products.get("p1")!.status).toBe("ACTIVE");
  });

  it("판매 요청이 없으면 아무것도 하지 않는다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    expect(await promoteIfReady("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("HIDDEN");
  });

  it("번역 비대상 소스(국내)는 이미지 상태와 무관하게 승격", async () => {
    seed("FAILED", null);
    products.get("p1")!.sourceUrl = "https://domeggook.com/x";
    products.get("p1")!.publishRequestedAt = new Date();
    expect(await promoteIfReady("p1")).toBe(true);
  });
});

describe("translateProductImages — 일괄 번역", () => {
  it("이미 VERIFIED·legacy 장은 건너뛴다 (재호출 금지)", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    const legacy: AssetRow = { ...assets.get("a1")!, id: "a2", translateStatus: null, originalUrl: "/uploads/o2.jpg", sortOrder: 1 };
    assets.set("a2", legacy);
    const report = await translateProductImages("p1");
    expect(autoMock).not.toHaveBeenCalled();
    expect(report.skipped).toBe(2);
  });

  it("같은 원본을 검증 완료한 형제가 있으면 API 없이 잇는다 — VERIFIED 형제만", async () => {
    const a = seed(); // 미번역, url=/uploads/orig-1.jpg
    const sib: AssetRow = {
      ...a, id: "a2", productId: "p1", url: "/uploads/t-sib.jpg", originalUrl: "/uploads/orig-1.jpg",
      translateStatus: "VERIFIED", ocrData: "[]", originalSha256: "sha-x", sortOrder: 1,
    };
    assets.set("a2", sib);
    const report = await translateProductImages("p1");
    expect(autoMock).not.toHaveBeenCalled();
    expect(assets.get("a1")!.url).toBe("/uploads/t-sib.jpg");
    expect(assets.get("a1")!.translateStatus).toBe("VERIFIED");
    expect(report.verified).toBe(1);
  });

  it.each(["NEEDS_REVIEW", "VERIFICATION_FAILED", "RETRYABLE", "FAILED"] as const)(
    "%s 장은 캐시가 없어도 자동으로 다시 렌더하지 않는다 — 재실행은 운영자 승인뿐",
    async (status) => {
      // 파이프라인 버전을 올리면 (sha256, pipelineVersion) 캐시가 전부 미스가 된다.
      // 그 상태에서 "판매"를 누를 때마다 검수 대기 이미지가 유료 재렌더되면
      // 장당 ~₩100 이 클릭마다 나간다 — 캐시가 아니라 상태로 막아야 한다.
      seed(status);
      cacheLookup.mockResolvedValue(null); // 캐시 미스
      const report = await translateProductImages("p1");
      expect(autoMock).not.toHaveBeenCalled();
      expect(report.skipped).toBe(1);
      expect(assets.get("a1")!.translateStatus).toBe(status); // 판정도 그대로
    },
  );

  it("TRANSLATING 은 중단된 흔적이므로 다시 돌린다 (판정이 아니다)", async () => {
    seed("TRANSLATING");
    cacheLookup.mockResolvedValue(null);
    autoMock.mockResolvedValue({ status: "NO_FOREIGN_TEXT" });
    await translateProductImages("p1");
    expect(autoMock).toHaveBeenCalledTimes(1);
  });

  it("검수 대기 결과가 나오면 보고서에 review 로 집계되고 승격은 일어나지 않는다", async () => {
    const a = seed();
    products.get("p1")!.publishRequestedAt = new Date();
    autoMock.mockResolvedValue({ status: "NEEDS_REVIEW", data: Buffer.from("c"), mime: "image/jpeg", boxes: BOXES, reasons: [{ code: "FLAGGED", detail: "1" }] });
    const report = await translateProductImages("p1");
    expect(report.review).toBe(1);
    expect(products.get("p1")!.status).toBe("HIDDEN");
    void a;
  });
});
