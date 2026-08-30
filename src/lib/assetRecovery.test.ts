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
  originalSha256: string | null;
}
const assets = new Map<string, AssetRow>();
const saved: string[] = [];
const audits: { summary: string; meta?: unknown }[] = [];
const demoted: string[] = [];
const promoted = vi.hoisted(() => [] as string[]);
const renderCalls: { hint?: string }[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    productAsset: {
      // Prisma 처럼 스냅샷을 돌려준다 — 같은 객체를 주면 이후 update 가 액션이
      // 들고 있는 asset 변수까지 바꿔 실제와 다른 동작이 된다
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = assets.get(where.id);
        return row ? { ...row } : null;
      },
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
const renderReject = vi.hoisted(() => ({ value: null as Error | null }));
vi.mock("@/lib/imageTranslate", () => ({
  renderTranslatedImage: async (_d: Buffer, _m: string, _b: unknown, opts?: { hint?: string }) => {
    renderCalls.push({ hint: opts?.hint });
    if (renderReject.value) throw renderReject.value;
    return { data: Buffer.from("rendered"), mime: "image/jpeg" };
  },
  parseOcrBoxes: (v: unknown) => v as unknown[],
}));
const runResult = vi.hoisted(() => ({ value: { result: "verified" } as { result: string; message?: string } }));
const runGate = vi.hoisted(() => ({ open: Promise.resolve(), calls: 0 }));
vi.mock("@/lib/import/translateAssets", async () => {
  const { createKeyedLock } = await import("./keyedLock");
  return {
    assetLock: createKeyedLock(),
    runAssetTranslation: async () => {
      runGate.calls++;
      await runGate.open;
      return runResult.value;
    },
    promoteIfReady: async (id: string) => { promoted.push(id); return false; },
    demoteIfUnsafe: async (id: string) => { demoted.push(id); return false; },
  };
});
const staleMarks = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/translateCache", () => ({
  sha256Of: () => "sha", saveTranslationCache: async () => {},
  markCacheStale: async (sha: string) => { staleMarks.push(sha); },
}));
vi.mock("@/lib/productAssets", () => ({
  assetKindFor: () => "DETAIL", nextThumbnail: () => null,
}));

const {
  uploadAssetCandidate,
  regenerateAssetWithHint,
  translateProductAsset,
  approveAssetRerender,
  approveAssetCandidates,
  rejectAssetCandidate,
  startAssetRerender,
  startAssetRegenerateWithHint,
} = await import("./actions/admin-assets");

/** 백그라운드 void 체인이 다 돌 때까지 마이크로태스크·타이머를 비운다 */
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const BOXES = JSON.stringify([{ box: [1, 2, 3, 4], zh: "强震", ko: "진동", bg: "#fff", fg: "#000" }]);

function seed(over: Partial<AssetRow> = {}): AssetRow {
  const row: AssetRow = {
    id: "a1", productId: "p1", kind: "DETAIL",
    url: "/uploads/translated.jpg", originalUrl: "/uploads/original.jpg",
    ocrData: BOXES, candidateUrl: null, candidateOcr: null,
    translateStatus: "NEEDS_REVIEW", reviewReasons: null, bytes: 10,
    originalSha256: null, ...over,
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
  assets.clear(); saved.length = 0; audits.length = 0; demoted.length = 0; promoted.length = 0; renderCalls.length = 0; staleMarks.length = 0;
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


/**
 * 검수함의 일괄 승인 — 여러 장을 하나씩 누르는 대신 체크해서 한 번에.
 * 승인 규칙은 개별 승인과 완전히 같아야 한다(후보가 있어야만, url 승격, 검수 해제).
 */
describe("approveAssetCandidates — 일괄 승인", () => {
  // seed() 는 항상 a1 키로 넣어서 두 번 부르면 첫 행이 덮인다 — 직접 만든다
  const seedWithCandidate = (id: string): AssetRow => {
    const row: AssetRow = {
      id, productId: "p1", kind: "DETAIL",
      url: `/uploads/tr-${id}.jpg`, originalUrl: `/uploads/orig-${id}.jpg`,
      ocrData: BOXES, candidateUrl: `/uploads/cand-${id}.jpg`, candidateOcr: BOXES,
      translateStatus: "NEEDS_REVIEW", reviewReasons: null, bytes: 10,
      originalSha256: null,
    };
    assets.set(id, row);
    return row;
  };

  it("후보 있는 장은 전부 승격되고 개수를 돌려준다", async () => {
    const a = seedWithCandidate("a1");
    const b = seedWithCandidate("a2");
    const r = await approveAssetCandidates(["a1", "a2"]);
    expect(r.approved).toBe(2);
    expect(a.url).toBe("/uploads/cand-a1.jpg");
    expect(b.url).toBe("/uploads/cand-a2.jpg");
    expect(a.translateStatus).toBe("VERIFIED");
  });

  it("후보 없는 장은 건너뛰고 이유를 남긴다 — 전체가 죽지 않는다", async () => {
    seedWithCandidate("a1");
    const noCand = seedWithCandidate("a2");
    noCand.candidateUrl = null;
    const r = await approveAssetCandidates(["a1", "a2", "ghost"]);
    expect(r.approved).toBe(1);
    expect(r.skipped).toBe(2);
    expect(assets.get("a1")!.translateStatus).toBe("VERIFIED");
    expect(noCand.translateStatus).not.toBe("VERIFIED"); // 승인 규칙 우회 금지
  });

  it("빈 목록은 아무것도 하지 않는다", async () => {
    const r = await approveAssetCandidates([]);
    expect(r.approved).toBe(0);
    expect(r.skipped).toBe(0);
  });
});


describe("approveAssetRerender — 원본 유지 자산도 명시적 재시도는 된다", () => {
  it("ORIGINAL_KEPT 에서 다시 만들기를 누르면 실행된다", async () => {
    // 자동 재번역은 금지지만(운영자 결정 보호), 버튼을 누르는 건 그 운영자의
    // 새 결정이다 — 검수함에 떠 있는데 눌러서 오류가 나면 막다른 길이 된다
    seed({ translateStatus: "ORIGINAL_KEPT" });
    runResult.value = { result: "review", message: "MANUAL_EDIT" };
    const r = await approveAssetRerender("a1");
    expect(r.error).toBeUndefined();
  });
});


/**
 * 백그라운드 재생성 (2026-08-31 실측 대응).
 *
 * 재생성은 30초~2분 걸리는데 서버 액션 응답을 그 시간 동안 붙잡으면 프록시가
 * 연결을 끊는다 — 화면엔 "요청이 끊겼습니다"가 뜨지만 서버는 완주하고 기록해서,
 * 운영자가 또 눌러 이중 과금될 위험이 있었다. 그래서 시작만 하고 즉시 응답하며,
 * 진행 표시(TRANSLATING)를 먼저 박아 화면 폴링이 상태를 따라가게 한다.
 */
describe("startAssetRerender — 백그라운드 재생성", () => {
  it("즉시 응답하고 진행 표시(TRANSLATING)를 먼저 박는다", async () => {
    const a = seed({ translateStatus: "NEEDS_REVIEW" });
    runResult.value = { result: "review", message: "LEFTOVER" };
    const r = await startAssetRerender("a1");
    expect(r.ok).toBe(true);
    expect(r.notice).toContain("자동으로 갱신");
    expect(a.translateStatus).toBe("TRANSLATING"); // 응답 시점에 이미 진행 표시
    await flush();
  });

  it("겹쳐 누르면 두 번째는 실행하지 않는다 — 이중 과금 차단", async () => {
    seed({ translateStatus: "FAILED" });
    runResult.value = { result: "review" };
    let release!: () => void;
    runGate.open = new Promise<void>((res) => { release = res; });
    runGate.calls = 0;

    const first = await startAssetRerender("a1");
    expect(first.ok).toBe(true);
    const second = await startAssetRerender("a1");
    expect(second.error ?? second.notice).toContain("이미 진행");

    release();
    await flush();
    expect(runGate.calls).toBe(1);
    runGate.open = Promise.resolve();
  });

  it("백그라운드가 던져도 TRANSLATING 에 갇히지 않는다", async () => {
    const a = seed({ translateStatus: "FAILED" });
    runGate.open = Promise.reject(new Error("render boom"));
    await startAssetRerender("a1");
    await flush();
    expect(a.translateStatus).toBe("FAILED"); // 실패로 착지, 진행 표시에 안 갇힘
    expect(a.reviewReasons).toContain("render boom");
    runGate.open = Promise.resolve();
    // 잠금도 풀려 다음 시도가 가능하다
    runResult.value = { result: "review" };
    const again = await startAssetRerender("a1");
    expect(again.ok).toBe(true);
    await flush();
  });

  it("허용되지 않은 상태(VERIFIED)는 시작하지 않는다", async () => {
    const a = seed({ translateStatus: "VERIFIED" });
    const r = await startAssetRerender("a1");
    expect(r.error).toBeTruthy();
    expect(a.translateStatus).toBe("VERIFIED");
  });
});

describe("startAssetRegenerateWithHint — 지시 재생성도 백그라운드", () => {
  it("빈 지시는 시작 전에 거른다 (진행 표시도 안 박는다)", async () => {
    const a = seed();
    const r = await startAssetRegenerateWithHint("a1", {}, fd({ hint: "  " }));
    expect(r.error).toBeTruthy();
    expect(a.translateStatus).toBe("NEEDS_REVIEW");
  });

  it("즉시 TRANSLATING, 완료 후 후보 생성 + 지시가 사유에 남는다", async () => {
    const a = seed();
    const r = await startAssetRegenerateWithHint("a1", {}, fd({ hint: "글자를 더 크게" }));
    expect(r.ok).toBe(true);
    expect(a.translateStatus).toBe("TRANSLATING");
    await flush();
    expect(a.translateStatus).toBe("NEEDS_REVIEW");
    expect(a.candidateUrl).toMatch(/^\/uploads\/gen-/);
    expect(a.reviewReasons).toContain("글자를 더 크게");
    expect(renderCalls[0].hint).toBe("글자를 더 크게");
  });

  it("렌더가 실패해도 TRANSLATING 에 갇히지 않고 사유가 남는다", async () => {
    const a = seed();
    renderReject.value = new Error("만들기 실패");
    const r = await startAssetRegenerateWithHint("a1", {}, fd({ hint: "고쳐줘" }));
    expect(r.ok).toBe(true);
    await flush();
    expect(a.translateStatus).toBe("NEEDS_REVIEW");
    expect(a.reviewReasons).toContain("만들기 실패");
    renderReject.value = null;
  });
});

describe("rejectAssetCandidate — 승인본이 걸려 있으면 거부해도 판매가 안 내려간다", () => {
  // 실사례(2026-08-30): 승인된 번역이 url 에 걸린 장에서 문구 수정 후보를
  // 거부하면 FAILED → demoteIfUnsafe 로 판매 중 상품이 통째로 숨겨졌다.
  // 손님용 그림은 멀쩡한 승인본 그대로였는데도.
  it("url ≠ originalUrl(승인본 노출 중)이면 후보만 버리고 VERIFIED 로 복원한다", async () => {
    const a = seed({
      candidateUrl: "/uploads/cand.png", candidateOcr: BOXES,
      originalSha256: "sha-orig",
    });
    const r = await rejectAssetCandidate("a1");
    expect(r.ok).toBe(true);
    expect(a.translateStatus).toBe("VERIFIED");
    expect(a.url).toBe("/uploads/translated.jpg");
    expect(a.candidateUrl).toBeNull();
    expect(a.candidateOcr).toBeNull();
    expect(demoted).toEqual([]);
    // 승인본 캐시는 유효하다 — 무효화하면 다음 자동 번역이 돈 내고 다시 돈다
    expect(staleMarks).toEqual([]);
    // 판매 전환 보류 중이었으면 이 거부로 전 이미지가 노출 가능해질 수 있다 —
    // 승인 경로와 똑같이 승격 검사를 걸어야 상품이 숨김에 갇히지 않는다
    expect(promoted).toEqual(["p1"]);
  });

  it("url = originalUrl(원본 노출 중)이면 기존대로 FAILED + 판매 점검 + 캐시 무효화", async () => {
    const a = seed({
      url: "/uploads/original.jpg", candidateUrl: "/uploads/cand.png",
      candidateOcr: BOXES, originalSha256: "sha-orig",
    });
    const r = await rejectAssetCandidate("a1");
    expect(r.ok).toBe(true);
    expect(a.translateStatus).toBe("FAILED");
    expect(a.candidateUrl).toBeNull();
    expect(demoted).toEqual(["p1"]);
    expect(staleMarks).toEqual(["sha-orig"]);
  });

  it("후보가 없으면 오류를 돌려준다", async () => {
    seed();
    const r = await rejectAssetCandidate("a1");
    expect(r.error).toBeTruthy();
  });
});
