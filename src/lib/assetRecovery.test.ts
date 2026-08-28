/**
 * 관리자 복구 액션 회귀 테스트 — 직접 업로드 / 개선 지시 재생성.
 *
 * 두 액션 모두 지켜야 하는 불변식은 같다:
 *  1. 결과는 **후보(candidateUrl)로만** 들어간다 — 자동 게시 금지
 *  2. 손님용 url 과 보존 원본 originalUrl 은 **절대 안 바뀐다**
 *  3. 상태는 NEEDS_REVIEW — 승인 전까지 노출 게이트가 막는다
 *
 * 이걸 어기면 검수를 거치지 않은 이미지가 손님에게 바로 나간다.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface AssetRow {
  id: string;
  productId: string;
  kind: string;
  url: string;
  originalUrl: string | null;
  ocrData: string | null;
  candidateUrl: string | null;
  candidateOcr: string | null;
  translateStatus: string | null;
  reviewReasons: string | null;
  bytes: number;
}
const assets = new Map<string, AssetRow>();
const saved: string[] = [];
const audits: { summary: string; meta?: unknown }[] = [];
const demoted: string[] = [];
const renderCalls: { hint?: string }[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    productAsset: {
      findUnique: async ({ where }: { where: { id: string } }) => assets.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<AssetRow> }) => {
        const r = assets.get(where.id)!;
        Object.assign(r, data);
        return r;
      },
      findMany: async () => [...assets.values()],
    },
    product: { findUnique: async () => null, update: async () => null, updateMany: async () => ({ count: 0 }) },
  },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ email: "admin@test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/audit", () => ({
  audit: async (a: { summary: string; meta?: unknown }) => { audits.push(a); },
}));
vi.mock("@/lib/storage", () => ({
  saveImageUpload: async (f: File) =>
    f.type === "text/plain"
      ? { ok: false as const, error: "JPG/PNG/WebP/AVIF/GIF 이미지만 업로드할 수 있습니다." }
      : { ok: true as const, url: `/uploads/up-${saved.push("u")}.png` },
  saveImageBuffer: async () => ({ ok: true as const, url: `/uploads/gen-${saved.push("g")}.png` }),
  deleteImageUpload: async () => {},
  deleteUploadIfUnused: async () => {},
  readPublicUpload: async () => ({ data: Buffer.from("orig"), contentType: "image/jpeg" }),
}));
vi.mock("@/lib/imageTranslate", () => ({
  renderTranslatedImage: async (_d: Buffer, _m: string, _b: unknown, opts?: { hint?: string }) => {
    renderCalls.push({ hint: opts?.hint });
    return { data: Buffer.from("rendered"), mime: "image/jpeg" };
  },
  parseOcrBoxes: (v: unknown) => v as unknown[],
}));
const runResult = vi.hoisted(() => ({ value: { result: "verified" } as { result: string; message?: string } }));
vi.mock("@/lib/import/translateAssets", () => ({
  runAssetTranslation: async () => runResult.value,
  promoteIfReady: async () => false,
  demoteIfUnsafe: async (id: string) => { demoted.push(id); return false; },
}));
vi.mock("@/lib/translateCache", () => ({
  sha256Of: () => "sha", saveTranslationCache: async () => {}, markCacheStale: async () => {},
}));
vi.mock("@/lib/productAssets", () => ({
  assetKindFor: () => "DETAIL", nextThumbnail: () => null,
}));

const { uploadAssetCandidate, regenerateAssetWithHint, translateProductAsset, approveAssetRerender } =
  await import("./actions/admin-assets");

const BOXES = JSON.stringify([{ box: [1, 2, 3, 4], zh: "强震", ko: "진동", bg: "#fff", fg: "#000" }]);

function seed(over: Partial<AssetRow> = {}): AssetRow {
  const row: AssetRow = {
    id: "a1", productId: "p1", kind: "DETAIL",
    url: "/uploads/translated.jpg", originalUrl: "/uploads/original.jpg",
    ocrData: BOXES, candidateUrl: null, candidateOcr: null,
    translateStatus: "NEEDS_REVIEW", reviewReasons: null, bytes: 10, ...over,
  };
  assets.set(row.id, row);
  return row;
}
const fd = (entries: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const png = (type = "image/png") => new File([new Uint8Array([1, 2, 3])], "fix.png", { type });

beforeEach(() => {
  assets.clear(); saved.length = 0; audits.length = 0; demoted.length = 0; renderCalls.length = 0;
  process.env.GEMINI_API_KEY = "test";
});

describe("uploadAssetCandidate — 직접 업로드는 후보로만 들어간다", () => {
  it("url·originalUrl 은 그대로, 후보만 생긴다", async () => {
    const a = seed();
    const r = await uploadAssetCandidate("a1", {}, fd({ file: png() }));
    expect(r.ok).toBe(true);
    expect(a.url).toBe("/uploads/translated.jpg");    // 손님이 보는 그림 불변
    expect(a.originalUrl).toBe("/uploads/original.jpg"); // 원본 보존 불변
    expect(a.candidateUrl).toMatch(/^\/uploads\/up-/);
    expect(a.translateStatus).toBe("NEEDS_REVIEW");    // 자동 게시 금지
  });

  it("아직 번역 안 된 자산에 올려도 원본 url 을 덮지 않는다", async () => {
    const a = seed({ originalUrl: null, url: "/uploads/raw.jpg", translateStatus: "FAILED", ocrData: null });
    await uploadAssetCandidate("a1", {}, fd({ file: png() }));
    expect(a.url).toBe("/uploads/raw.jpg");
    expect(a.originalUrl).toBeNull();
    expect(a.candidateUrl).toMatch(/^\/uploads\/up-/);
  });

  it("이미지가 아니면 거부하고 아무것도 바꾸지 않는다", async () => {
    const a = seed();
    const bad = new File(["<script>"], "x.txt", { type: "text/plain" });
    const r = await uploadAssetCandidate("a1", {}, fd({ file: bad }));
    expect(r.error).toBeTruthy();
    expect(a.candidateUrl).toBeNull();
    expect(a.translateStatus).toBe("NEEDS_REVIEW");
  });

  it("GIF 는 이번 범위 밖이라 거부한다", async () => {
    const a = seed();
    const r = await uploadAssetCandidate("a1", {}, fd({ file: png("image/gif") }));
    expect(r.error).toContain("GIF");
    expect(a.candidateUrl).toBeNull();
  });

  it("파일을 안 고르면 안내만 하고 끝난다", async () => {
    const a = seed();
    const r = await uploadAssetCandidate("a1", {}, new FormData());
    expect(r.error).toBeTruthy();
    expect(a.candidateUrl).toBeNull();
  });

  it("업로드는 유료 렌더를 부르지 않는다", async () => {
    seed();
    await uploadAssetCandidate("a1", {}, fd({ file: png() }));
    expect(renderCalls).toHaveLength(0);
  });

  it("검수 대기가 됐으므로 판매 중이면 내리도록 강등을 부른다", async () => {
    seed();
    await uploadAssetCandidate("a1", {}, fd({ file: png() }));
    expect(demoted).toContain("p1");
  });
});

describe("regenerateAssetWithHint — 개선 지시 재생성도 후보로만", () => {
  it("지시가 렌더에 실리고 결과는 후보로만 들어간다", async () => {
    const a = seed();
    const r = await regenerateAssetWithHint("a1", {}, fd({ hint: "표 글자가 잘렸습니다" }));
    expect(r.ok).toBe(true);
    expect(renderCalls[0].hint).toBe("표 글자가 잘렸습니다");
    expect(a.url).toBe("/uploads/translated.jpg");     // 불변
    expect(a.originalUrl).toBe("/uploads/original.jpg"); // 불변
    expect(a.candidateUrl).toMatch(/^\/uploads\/gen-/);
    expect(a.translateStatus).toBe("NEEDS_REVIEW");
  });

  it("지시가 비면 유료 호출 없이 거부한다", async () => {
    seed();
    const r = await regenerateAssetWithHint("a1", {}, fd({ hint: "   " }));
    expect(r.error).toBeTruthy();
    expect(renderCalls).toHaveLength(0);
  });

  it("문구 기록이 없으면 유료 호출 없이 거부한다", async () => {
    seed({ ocrData: null, candidateOcr: null });
    const r = await regenerateAssetWithHint("a1", {}, fd({ hint: "고쳐줘" }));
    expect(r.error).toContain("재렌더 승인");
    expect(renderCalls).toHaveLength(0);
  });

  it("검수 대기 자산은 candidateOcr 의 문구로 다시 만든다", async () => {
    seed({ ocrData: null, candidateOcr: BOXES });
    const r = await regenerateAssetWithHint("a1", {}, fd({ hint: "더 작게" }));
    expect(r.ok).toBe(true);
    expect(renderCalls).toHaveLength(1);
  });

  it("사유에 지시가 남아 나중에 무엇을 시켰는지 알 수 있다", async () => {
    const a = seed();
    await regenerateAssetWithHint("a1", {}, fd({ hint: "워터마크가 남았습니다" }));
    expect(a.reviewReasons).toContain("워터마크가 남았습니다");
    expect(JSON.stringify(audits)).toContain("워터마크가 남았습니다");
  });

  it("300자를 넘는 지시는 잘라 넣는다", async () => {
    seed();
    await regenerateAssetWithHint("a1", {}, fd({ hint: "가".repeat(500) }));
    expect(renderCalls[0].hint!.length).toBe(300);
  });
});


/**
 * 번역 버튼의 결과 표시 — 정상 결과를 오류로 보여주지 않는다.
 *
 * 실사례(2026-08-28 운영 테스트): "외국어 없음"과 "검수 대기"는 파이프라인이
 * 의도대로 내린 **정상 판정**인데 { error } 로 돌아와 화면에 빨간 오류로 떴다.
 * 번역을 누를 때마다 빨간 글씨가 나오니 운영자는 기능이 고장났다고 읽는다.
 * 정상 판정은 notice(안내), 진짜 실패만 error 다.
 */
describe("translateProductAsset — 정상 판정은 notice, 실패만 error", () => {
  it("외국어 없음은 안내로 돌아온다", async () => {
    seed();
    runResult.value = { result: "no_foreign" };
    const r = await translateProductAsset("a1");
    expect(r.error).toBeUndefined();
    expect(r.notice).toContain("외국어");
  });

  it("검수 대기도 안내다 — 판정이지 고장이 아니다", async () => {
    seed();
    runResult.value = { result: "review", message: "LEFTOVER" };
    const r = await translateProductAsset("a1");
    expect(r.error).toBeUndefined();
    expect(r.notice).toContain("검수 대기");
    expect(r.notice).toContain("LEFTOVER"); // 사유는 그대로 보인다
  });

  it("검증 통과는 ok", async () => {
    seed();
    runResult.value = { result: "verified" };
    const r = await translateProductAsset("a1");
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it("일시 오류·실패는 여전히 error 다", async () => {
    seed();
    runResult.value = { result: "retryable", message: "TIMEOUT" };
    expect((await translateProductAsset("a1")).error).toContain("일시 오류");
    runResult.value = { result: "failed", message: "원인" };
    expect((await translateProductAsset("a1")).error).toContain("번역 실패");
  });
});


describe("approveAssetRerender — 재렌더의 정상 판정도 안내다", () => {
  it("검수 대기로 돌아오면 notice — 후보가 생겼다는 뜻이지 고장이 아니다", async () => {
    seed({ translateStatus: "NEEDS_REVIEW" });
    runResult.value = { result: "review", message: "MANUAL_EDIT" };
    const r = await approveAssetRerender("a1");
    expect(r.error).toBeUndefined();
    expect(r.notice).toContain("검수 대기");
  });

  it("실패·일시 오류는 여전히 error", async () => {
    seed({ translateStatus: "FAILED" });
    runResult.value = { result: "failed", message: "원인" };
    expect((await approveAssetRerender("a1")).error).toBeTruthy();
  });
});
