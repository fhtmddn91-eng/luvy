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

/**
 * productAsset.findMany 를 가로챌 수 있게 한 겹 둔다.
 * 승격의 "게이트를 보는 사이"에 다른 일이 끼어드는 경쟁 조건을 재현하는 데 쓴다.
 */
const assetFindManyHook = vi.hoisted(() => ({
  fn: (async () => []) as (args: { where: { productId: string } }) => Promise<unknown[]>,
}));

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
      findMany: async (args: { where: { productId: string } }) => assetFindManyHook.fn(args),
    },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<ProductRow> }) => {
        const row = products.get(where.id);
        if (!row) throw new Error("no product");
        Object.assign(row, data);
        return row;
      },
      /**
       * 조건부 갱신 — `publishRequestedAt: { not: null }` 만 해석한다.
       * 승격이 이 조건을 실제로 걸고 있는지 보려면 목도 조건을 지켜야 한다.
       */
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; publishRequestedAt?: { not: null } };
        data: Partial<ProductRow>;
      }) => {
        const row = products.get(where.id);
        if (!row) return { count: 0 };
        if (where.publishRequestedAt?.not === null && row.publishRequestedAt === null) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
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

const { runAssetTranslation, promoteIfReady, demoteIfUnsafe, translateProductImages } = await import("./translateAssets");

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
  assetFindManyHook.fn = async ({ where }) =>
    [...assets.values()].filter((a) => a.productId === where.productId).sort((a, b) => a.sortOrder - b.sortOrder);
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

  /**
   * 실사례(2026-08-27 감사): 운영자가 판매 요청 후 마음을 바꿔 상품을 숨기면
   * 판매 요청도 함께 취소되는데(productSaveStatusData), 승격이 읽고→검사→쓰기
   * 였던 탓에 그 취소를 덮어써 숨긴 상품이 손님에게 다시 떴다.
   */
  it("판매 요청이 취소된 상품은 번역이 다 끝나도 승격하지 않는다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.publishRequestedAt = null; // 운영자가 숨김 저장으로 취소
    expect(await promoteIfReady("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("HIDDEN");
  });

  it("게이트를 보는 사이에 판매 요청이 취소되면 승격이 그걸 덮어쓰지 않는다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    const p = products.get("p1")!;
    p.publishRequestedAt = new Date();
    // 게이트 통과 직후·갱신 직전에 운영자가 숨김 저장을 끝낸 상황을 재현한다
    const realFindMany = assetFindManyHook.fn;
    assetFindManyHook.fn = async (args) => {
      const r = await realFindMany(args);
      p.publishRequestedAt = null;
      return r;
    };
    try {
      expect(await promoteIfReady("p1")).toBe(false);
      expect(p.status).toBe("HIDDEN"); // 조건부 갱신이 막는다
    } finally {
      assetFindManyHook.fn = realFindMany;
    }
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

/**
 * 겹친 실행 중복 과금 차단 (실사례 2026-08-27 감사).
 *
 * 번역은 `void translateProductImages(...)` 로 백그라운드에서 돌고 장당 십수 초
 * × 수십 장이 걸린다. 그 사이 운영자가 "판매" 토글이나 상품 저장을 한 번 더
 * 누르면 2차 실행이 겹치는데, 자산별 건너뛰기 목록이 TRANSLATING 을 "중단된
 * 흔적"으로 보고 다시 돌리기 때문에 1차가 작업 중인 자산을 2차가 또 집었다.
 * 1차 결과는 아직 캐시에 저장 전이라 미스가 나고, 같은 원본에 유료 이미지
 * 호출($0.067)이 두 번 나갔다 — 30장 상품이면 ~$2.
 */
describe("translateProductImages — 겹친 실행이 같은 자산을 두 번 번역하지 않는다", () => {
  it("번역 중에 판매를 다시 눌러도 유료 호출은 자산당 한 번뿐", async () => {
    seed(null, null);
    let inFlight = 0;
    let maxInFlight = 0;
    autoMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20)); // 장당 십수 초를 줄인 것
      inFlight--;
      return { status: "VERIFIED", data: Buffer.from("t"), mime: "image/jpeg", boxes: BOXES };
    });

    // 1차가 도는 중에 2차가 들어온다
    const [first, second] = await Promise.all([
      translateProductImages("p1"),
      translateProductImages("p1"),
    ]);

    expect(autoMock).toHaveBeenCalledTimes(1); // 핵심: 유료 호출 1회
    expect(maxInFlight).toBe(1);
    // 한쪽만 번역하고 다른 쪽은 건너뛴다 — 합쳐서 검증 1장
    expect(first.verified + second.verified).toBe(1);
    expect(first.skipped + second.skipped).toBe(1);
  });

  it("겹치지 않은 다음 실행은 정상 동작한다 — 선점이 영구 잠금이 되면 안 된다", async () => {
    seed(null, null);
    autoMock.mockResolvedValue({ status: "VERIFIED", data: Buffer.from("t"), mime: "image/jpeg", boxes: BOXES });
    await translateProductImages("p1");
    expect(autoMock).toHaveBeenCalledTimes(1);

    // 판정이 끝나 두 번째는 건너뛰지만, 잠금 때문이 아니라 정책 때문이어야 한다
    assets.get("a1")!.translateStatus = null;
    assets.get("a1")!.originalUrl = null;
    await translateProductImages("p1");
    expect(autoMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * 판매 중 상품의 이미지가 바뀌었을 때 (실사례 2026-08-27 감사).
 *
 * 노출 게이트가 **판매 전환 시점에만** 돌아서, 이미 ACTIVE 인 상품에 이미지를
 * 추가하거나(미번역 원본) 수동 번역을 걸면(TRANSLATING·NEEDS_REVIEW) 중국어
 * 원본이 손님에게 그대로 보이는데도 상품은 ACTIVE 로 남았다. 승격(promoteIfReady)
 * 만 있고 강등이 없었다 — "번역 중 중국어 원본이 손님에게 보이는 창이 없다"는
 * 불변식이 판매 중 변경에는 지켜지지 않았다.
 */
describe("demoteIfUnsafe — 판매 중 이미지가 노출 불가가 되면 즉시 내린다", () => {
  it("ACTIVE 상품에 미번역 이미지가 생기면 숨김으로 내린다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.status = "ACTIVE";
    // 운영자가 판매 중 상품에 원본 이미지를 추가했다
    assets.set("a2", { ...assets.get("a1")!, id: "a2", translateStatus: null, originalUrl: null, sortOrder: 1 });

    expect(await demoteIfUnsafe("p1")).toBe(true);
    expect(products.get("p1")!.status).toBe("HIDDEN");
  });

  it("내릴 때 판매 요청을 남겨 번역이 끝나면 자동으로 되올라간다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.status = "ACTIVE";
    assets.set("a2", { ...assets.get("a1")!, id: "a2", translateStatus: "TRANSLATING", sortOrder: 1 });

    await demoteIfUnsafe("p1");
    expect(products.get("p1")!.status).toBe("HIDDEN");
    expect(products.get("p1")!.publishRequestedAt).not.toBeNull();

    // 번역·검수가 끝나면 되올린다 — 운영자가 다시 누를 필요가 없다
    assets.get("a2")!.translateStatus = "VERIFIED";
    expect(await promoteIfReady("p1")).toBe(true);
    expect(products.get("p1")!.status).toBe("ACTIVE");
  });

  it("전부 노출 허용이면 판매를 건드리지 않는다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.status = "ACTIVE";
    expect(await demoteIfUnsafe("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("ACTIVE");
  });

  it("이미 숨김인 상품은 판매 요청을 새로 만들지 않는다", async () => {
    // 운영자가 의도적으로 숨긴 상품을 이미지 변경이 판매 대기로 바꾸면 안 된다
    seed(null, null);
    products.get("p1")!.status = "HIDDEN";
    expect(await demoteIfUnsafe("p1")).toBe(false);
    expect(products.get("p1")!.publishRequestedAt).toBeNull();
  });

  it("번역 비대상(국내 도매처)은 이미지 상태와 무관하게 내리지 않는다", async () => {
    seed("FAILED", null);
    products.get("p1")!.status = "ACTIVE";
    products.get("p1")!.sourceUrl = "https://domestic.example.com/x";
    expect(await demoteIfUnsafe("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("ACTIVE");
  });
});

/**
 * 강등은 "관리자가 명시적으로 숨긴 것"과 "시스템이 임시로 내린 것"을 구분해야 한다.
 *
 * 구분 신호는 publishRequestedAt 이다:
 *  - 관리자 명시적 숨김 = HIDDEN + publishRequestedAt null (productSaveStatusData 가 지운다)
 *  - 시스템 임시 숨김   = HIDDEN + publishRequestedAt 있음 (검수 끝나면 자동 복귀)
 * 이 구분이 무너지면 관리자가 숨긴 상품이 번역 완료로 되살아난다.
 */
describe("demoteIfUnsafe / promoteIfReady — 명시적 숨김과 임시 숨김의 구분", () => {
  it("시스템 임시 숨김은 검수가 끝나면 스스로 복귀한다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.status = "ACTIVE";
    assets.set("a2", { ...assets.get("a1")!, id: "a2", translateStatus: "TRANSLATING", sortOrder: 1 });

    await demoteIfUnsafe("p1");
    expect(products.get("p1")!.publishRequestedAt).not.toBeNull(); // 임시 숨김 표시

    assets.get("a2")!.translateStatus = "VERIFIED";
    expect(await promoteIfReady("p1")).toBe(true);
  });

  it("관리자 명시적 숨김은 검수가 끝나도 복귀하지 않는다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    // 관리자가 숨김 저장 → publishRequestedAt 이 지워진 상태
    products.get("p1")!.status = "HIDDEN";
    products.get("p1")!.publishRequestedAt = null;

    expect(await promoteIfReady("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("HIDDEN");
  });

  it("강등은 이미 숨김인 상품에 임시 숨김 표시를 새로 달지 않는다", async () => {
    // 관리자가 숨긴 상품을 시스템이 '판매 대기'로 바꿔 놓으면 안 된다
    seed(null, null);
    products.get("p1")!.status = "HIDDEN";
    products.get("p1")!.publishRequestedAt = null;
    expect(await demoteIfUnsafe("p1")).toBe(false);
    expect(products.get("p1")!.publishRequestedAt).toBeNull();
  });
});

/**
 * 자산 삭제 뒤의 자동 승격은 **남은 전 장이 통과일 때만** 일어나야 한다.
 * (deleteProductAsset 이 부르는 promoteIfReady 가 게이트를 통째로 다시 본다)
 */
describe("promoteIfReady — 차단 자산이 남아 있으면 승격하지 않는다", () => {
  it("차단 자산 2장 중 1장만 지워지면 여전히 보류", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.publishRequestedAt = new Date();
    assets.set("a2", { ...assets.get("a1")!, id: "a2", translateStatus: "FAILED", sortOrder: 1 });
    assets.set("a3", { ...assets.get("a1")!, id: "a3", translateStatus: "NEEDS_REVIEW", sortOrder: 2 });

    assets.delete("a2"); // 한 장 삭제
    expect(await promoteIfReady("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("HIDDEN");

    assets.delete("a3"); // 마지막 차단 자산 삭제
    expect(await promoteIfReady("p1")).toBe(true);
    expect(products.get("p1")!.status).toBe("ACTIVE");
  });

  it("판매 요청이 없는 상품은 자산을 지워도 저절로 팔리지 않는다", async () => {
    seed("VERIFIED", "/uploads/o.jpg");
    products.get("p1")!.publishRequestedAt = null; // 판매 요청 없음
    expect(await promoteIfReady("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("HIDDEN");
  });

  it("원본 유지(ORIGINAL_KEPT) 자산이 있으면 승격하지 않는다 — 외국어 원본 자동 노출 금지", async () => {
    seed("ORIGINAL_KEPT", "/uploads/o.jpg");
    products.get("p1")!.publishRequestedAt = new Date();
    expect(await promoteIfReady("p1")).toBe(false);
    expect(products.get("p1")!.status).toBe("HIDDEN");
  });
});

/**
 * 원본 유지(ORIGINAL_KEPT)는 운영자가 "이 번역본 대신 원본을 쓰겠다"고 내린 결정이다.
 *
 * 실사례(2026-08-27 감사): 이 상태가 자동 번역 건너뛰기 목록에 없어서, 다음
 * "판매" 클릭 때 다시 번역 대상이 됐다 — 운영자 결정을 덮어쓰고 유료 이미지
 * 호출($0.067)까지 나갔다. 재실행은 설계대로 운영자 승인 경로뿐이어야 한다(정책 8).
 */
describe("translateProductImages — 원본 유지 자산은 자동 재번역하지 않는다", () => {
  it("ORIGINAL_KEPT 자산은 건너뛰고 유료 호출을 하지 않는다", async () => {
    seed("ORIGINAL_KEPT", "/uploads/o.jpg");
    const report = await translateProductImages("p1");
    expect(autoMock).not.toHaveBeenCalled();
    expect(report.skipped).toBe(1);
    expect(report.verified).toBe(0);
  });

  it("판매를 여러 번 눌러도 계속 건너뛴다 — 결정이 유지된다", async () => {
    const a = seed("ORIGINAL_KEPT", "/uploads/o.jpg");
    await translateProductImages("p1");
    await translateProductImages("p1");
    expect(autoMock).not.toHaveBeenCalled();
    expect(a.translateStatus).toBe("ORIGINAL_KEPT"); // 상태도 안 바뀐다
  });
});
