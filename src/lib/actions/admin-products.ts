"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safeAdminReturnPath } from "@/lib/adminReturnPath";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { translateProductImages, promoteIfReady, ensureKoreanName } from "@/lib/import/translateAssets";
import { productPublishGate, productSaveStatusData, gateSummary, isPlaceholderBrand, PLACEHOLDER_BRAND } from "@/lib/productPublishGate";
import { sourceForUrl } from "@/lib/import/sources";
import { saveImageUpload, deleteImageUpload, deleteUploadIfUnused } from "@/lib/storage";
import { normalizeSku, skuError } from "@/lib/sku";
import { categorySetFor, keepKnown } from "@/lib/productCategories";

export type ProductFormState = { error?: string };

/**
 * 대표 + 추가 카테고리를 조인 테이블에 통째로 다시 쓴다.
 * 존재하지 않는 slug 는 버린다 — 폼이 오래된 상태로 제출돼도 저장 자체는 살린다.
 */
async function categoryRows(
  primary: string,
  extras: string[],
): Promise<{ categorySlug: string }[]> {
  const known = (await db.category.findMany({ select: { slug: true } })).map((c) => c.slug);
  const slugs = keepKnown(categorySetFor(primary, extras), known);
  return slugs.map((categorySlug) => ({ categorySlug }));
}

/**
 * 업로드 파일이 있으면 저장하고 URL을, 없으면 undefined(기존 유지)를 반환.
 * 실패 시 문자열 에러.
 */
async function handleImage(
  formData: FormData,
): Promise<{ url?: string; bytes?: number } | { error: string }> {
  const file = formData.get("imageFile");
  if (!(file instanceof File) || file.size === 0) return {};
  const saved = await saveImageUpload(file);
  if (!saved.ok) return { error: saved.error };
  return { url: saved.url, bytes: file.size };
}

/**
 * 폼에서 올린 썸네일을 첫 대표이미지로도 등록한다.
 *
 * 썸네일(Product.image)은 자산이 아니어서, 직접 등록한 상품은 이미지를 넣어도
 * 상세 상단 갤러리와 판매자료 다운로드에 한 장도 안 잡혔다 — 자산이 0건이면
 * 다운로드 구역 자체가 사라진다. "썸네일 = 첫 대표이미지"라는 규칙을 데이터로도
 * 지키면 썸네일·갤러리·다운로드가 언제나 같은 것을 가리킨다.
 */
async function registerThumbnailAsset(
  productId: string,
  url: string,
  bytes: number,
): Promise<void> {
  await db.productAsset.updateMany({
    where: { productId },
    data: { sortOrder: { increment: 1 } },
  });
  await db.productAsset.create({
    data: { productId, kind: "MAIN", url, bytes, sortOrder: 0 },
  });
}

/**
 * 옵션 입력 파싱. 이름이 비면 버린다.
 * 같은 이름이 둘이면 뒤엣것을 버린다 — 이름으로 기존 옵션과 짝을 맞추기 때문에
 * 중복이 있으면 어느 쪽을 살릴지 정할 수 없다.
 */
export interface OptionInput {
  name: string;
  unitPrice: number;
  trackStock: boolean;
  stock: number;
  sortOrder: number;
}

function parseOptions(formData: FormData): OptionInput[] {
  const names = formData.getAll("optionName").map((v) => String(v).trim());
  const prices = formData.getAll("optionPrice").map((v) => parseInt(String(v), 10));
  const tracks = formData.getAll("optionTrack").map((v) => String(v) === "1");
  const stocks = formData.getAll("optionStock").map((v) => parseInt(String(v), 10));

  const out: OptionInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i].slice(0, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      unitPrice: Number.isFinite(prices[i]) && prices[i] > 0 ? prices[i] : 0,
      trackStock: tracks[i] ?? false,
      stock: Number.isFinite(stocks[i]) && stocks[i] > 0 ? stocks[i] : 0,
      sortOrder: out.length,
    });
  }
  return out;
}

/**
 * 옵션을 입력값에 맞춘다.
 *
 * 통째로 지웠다 다시 만들면 안 된다 — 장바구니(CartItem.optionId)가 사라진
 * 옵션을 가리켜 주문이 막힌다. 이름으로 짝을 맞춰 기존 것은 갱신하고,
 * 빠진 것만 지운다.
 */
async function syncOptions(productId: string, rows: OptionInput[]): Promise<void> {
  const existing = await db.productOption.findMany({
    where: { productId },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map((o) => [o.name, o.id]));
  const keep = new Set<string>();

  for (const r of rows) {
    const id = byName.get(r.name);
    if (id) {
      keep.add(id);
      await db.productOption.update({ where: { id }, data: { ...r, active: true } });
    } else {
      const created = await db.productOption.create({ data: { ...r, productId } });
      keep.add(created.id);
    }
  }
  const gone = existing.filter((o) => !keep.has(o.id)).map((o) => o.id);
  if (gone.length > 0) {
    await db.productOption.deleteMany({ where: { id: { in: gone } } });
    // 사라진 옵션을 담고 있던 장바구니 줄도 함께 정리한다
    await db.cartItem.deleteMany({ where: { productId, optionId: { in: gone } } });
  }
}

function parseTiers(formData: FormData): { minQty: number; unitPrice: number }[] {
  const minQtys = formData.getAll("tierMinQty").map((v) => parseInt(String(v), 10));
  const unitPrices = formData.getAll("tierUnitPrice").map((v) => parseInt(String(v), 10));
  const tiers: { minQty: number; unitPrice: number }[] = [];
  for (let i = 0; i < minQtys.length; i++) {
    const minQty = minQtys[i];
    const unitPrice = unitPrices[i];
    if (Number.isFinite(minQty) && Number.isFinite(unitPrice) && minQty > 0 && unitPrice > 0) {
      tiers.push({ minQty, unitPrice });
    }
  }
  return tiers.sort((a, b) => a.minQty - b.minQty);
}

function parseFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    brand: String(formData.get("brand") ?? "").trim(),
    categorySlug: String(formData.get("categorySlug") ?? "").trim(),
    sku: normalizeSku(String(formData.get("sku") ?? "")),
    description: String(formData.get("description") ?? "").trim(),
    basePrice: parseInt(String(formData.get("basePrice") ?? "0"), 10) || 0,
    status: String(formData.get("status") ?? "ACTIVE"),
    trackStock: formData.get("trackStock") === "on",
    stock: Math.max(0, parseInt(String(formData.get("stock") ?? "0"), 10) || 0),
  };
}

/** 추가 카테고리 체크박스. 대표 카테고리는 여기 없어도 categorySetFor 가 채운다. */
function parseExtraCategories(formData: FormData): string[] {
  return formData.getAll("extraCategories").map((v) => String(v).trim()).filter(Boolean);
}

function validate(f: ReturnType<typeof parseFields>, tiers: { minQty: number }[]): string | null {
  if (!f.name) return "상품명을 입력해주세요.";
  if (!f.brand) return "브랜드를 입력해주세요.";
  // 자리표시자("미정")는 **판매로 내보낼 때만** 막는다. 숨김 상태로 가격·카테고리만
  // 먼저 저장하는 건 정상 작업이라, 그것까지 막으면 수집분을 손볼 수가 없다.
  // (판매 전환은 requestPublish 게이트가 따로 막으므로 이중 방어다)
  if (f.status === "ACTIVE" && isPlaceholderBrand(f.brand)) {
    return `판매하려면 실제 브랜드를 입력해주세요. (수집 기본값 "${PLACEHOLDER_BRAND}"으로는 판매할 수 없습니다)`;
  }
  if (!f.categorySlug) return "대표 카테고리를 선택해주세요.";
  const sku = skuError(f.sku);
  if (sku) return sku;
  if (f.basePrice <= 0) return "권장 판매가를 올바르게 입력해주세요.";
  if (tiers.length === 0) return "수량별 도매가를 최소 1개 입력해주세요.";
  return null;
}

/**
 * 품번 중복. DB unique 제약이 최종 방어선이지만, 그대로 터뜨리면
 * 운영자에게 Prisma 예외 화면이 뜨므로 먼저 걸러 문구로 알려준다.
 */
async function duplicateSkuError(sku: string | null, selfId?: string): Promise<string | null> {
  if (sku === null) return null;
  const owner = await db.product.findUnique({ where: { sku }, select: { id: true, name: true } });
  if (!owner || owner.id === selfId) return null;
  return `품번 ${sku} 은(는) 이미 "${owner.name}" 에 쓰이고 있습니다.`;
}

export async function createProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  await requireAdmin();
  const fields = parseFields(formData);
  const tiers = parseTiers(formData);
  const err = validate(fields, tiers);
  if (err) return { error: err };
  const dup = await duplicateSkuError(fields.sku);
  if (dup) return { error: dup };

  const image = await handleImage(formData);
  if ("error" in image) return { error: image.error };

  const cats = await categoryRows(fields.categorySlug, parseExtraCategories(formData));
  const created = await db.product.create({
    data: {
      ...fields,
      image: image.url ?? "",
      priceTiers: { create: tiers },
      categories: { create: cats },
    },
  });
  await syncOptions(created.id, parseOptions(formData));
  if (image.url) await registerThumbnailAsset(created.id, image.url, image.bytes ?? 0);
  await audit({
    action: "PRODUCT_CREATE",
    target: "product",
    targetId: created.id,
    summary: `${created.name} 등록 (${created.status === "ACTIVE" ? "판매중" : "숨김"})`,
    meta: { tiers: tiers.length, sku: created.sku ?? "", categories: cats.length },
  });
  revalidatePath("/admin/products");
  revalidatePath("/");
  // 등록 화면 안내문("저장 직후 열리는 상품 수정 화면")대로 수정 화면으로 —
  // 상세페이지 이미지를 이어서 올릴 수 있어야 한다.
  redirect(`/admin/products/${created.id}`);
}

export async function updateProduct(id: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  await requireAdmin();
  const fields = parseFields(formData);
  const tiers = parseTiers(formData);
  const err = validate(fields, tiers);
  if (err) return { error: err };
  const dup = await duplicateSkuError(fields.sku, id);
  if (dup) return { error: dup };

  const image = await handleImage(formData);
  if ("error" in image) return { error: image.error };

  // 새 이미지가 업로드되면 이전 업로드 파일은 정리.
  // 단 썸네일은 상세 이미지와 같은 파일을 가리키므로, 아직 쓰는 곳이 있으면 남긴다
  if (image.url) {
    const prev = await db.product.findUnique({ where: { id }, select: { image: true } });
    if (prev?.image) await deleteUploadIfUnused(prev.image);
  }

  // 티어와 카테고리는 매번 통째로 갈아끼운다 (부분 수정이면 지운 항목이 남는다)
  const cats = await categoryRows(fields.categorySlug, parseExtraCategories(formData));
  await db.$transaction([
    db.priceTier.deleteMany({ where: { productId: id } }),
    db.productCategory.deleteMany({ where: { productId: id } }),
    db.product.update({
      where: { id },
      data: {
        ...fields,
        // ACTIVE 는 게이트를 거쳐야 한다 — 여기서는 일단 현 상태를 건드리지 않고
        // 아래 requestPublish 가 검증 결과에 따라 ACTIVE/보류를 정한다.
        // 반대로 숨김 저장은 대기 중인 판매 요청까지 취소한다 — 안 그러면 번역
        // 완료 시점의 promoteIfReady 가 운영자가 숨긴 상품을 되살린다.
        ...productSaveStatusData(fields.status),
        ...(image.url ? { image: image.url } : {}),
        priceTiers: { create: tiers },
        categories: { create: cats },
      },
    }),
  ]);
  await syncOptions(id, parseOptions(formData));
  if (image.url) await registerThumbnailAsset(id, image.url, image.bytes ?? 0);
  if (fields.status === "ACTIVE") await requestPublish(id);
  await audit({
    action: "PRODUCT_UPDATE",
    target: "product",
    targetId: id,
    summary: `${fields.name} 수정`,
    meta: {
      status: fields.status,
      trackStock: fields.trackStock,
      stock: fields.stock,
      tiers: tiers.length,
      sku: fields.sku ?? "",
      categories: cats.length,
    },
  });
  revalidatePath("/admin/products");
  revalidatePath(`/products/${id}`);
  revalidatePath("/");
  // 열었던 목록 페이지로 돌아간다 — 폼 값은 주소창에서 온 것이라 여기서 다시 거른다
  redirect(safeAdminReturnPath(String(formData.get("back") ?? ""), "/admin/products"));
}

/**
 * 판매 전환 시점에 이미지 번역을 돌린다 (1688 등 번역이 필요한 소스만).
 *
 * 수집 시점에 번역하면 안 파는 상품 번역비까지 나간다 — 수집분 상당수는
 * 가격을 못 맞춰 그대로 묻힌다(장당 ~$0.05). 판매로 전환하는 상품만 돌리면
 * 실제로 손님이 볼 이미지에만 비용이 든다. 이미 번역된 장·글자 없는 장은
 * translateProductImages 안에서 걸러진다.
 */
async function translateOnPublish(productId: string): Promise<void> {
  const p = await db.product.findUnique({
    where: { id: productId },
    select: { sourceUrl: true },
  });
  if (!p?.sourceUrl || sourceForUrl(p.sourceUrl)?.translate !== true) return;
  const untranslated = await db.productAsset.count({
    where: { productId, originalUrl: null },
  });
  if (untranslated === 0) return;
  // 장당 십수 초 × 수십 장 — 응답을 붙잡지 않고 뒤에서 돌린다.
  // 운영자는 어드민을 새로고침하면 번역된 이미지를 본다.
  //
  // 여기서 revalidatePath 를 부르면 안 된다 — 이 콜백은 응답이 끝난 뒤의 분리된
  // 컨텍스트라 Next 가 "revalidatePath during render is unsupported" 예외를 던지고,
  // 번역은 다 됐는데 성공 로그 대신 "번역 실패"가 찍힌다(운영 실측 2026-08-17).
  // 상세페이지는 로그인 확인(cookies) 때문에 항상 동적 렌더라 캐시 무효화가 필요 없다.
  void translateProductImages(productId)
    .then((r) => {
      console.log(`[publish] 이미지 번역 검증 ${r.verified}장 (검수 ${r.review} · 실패 ${r.failed} · 건너뜀 ${r.skipped})`);
    })
    .catch((e) => console.warn(`[publish] 이미지 번역 실패: ${e}`));
}

/**
 * 판매 전환 게이트 (설계 2026-08-24 v2.1 정책 9·10).
 *
 * 번역 대상 소스는 전 이미지가 검증 통과(VERIFIED·NO_FOREIGN_TEXT·legacy)여야
 * ACTIVE 가 된다. 아니면 HIDDEN 인 채 publishRequestedAt 만 기록하고 번역을
 * 돌린다 — 끝나면 translateProductImages 안의 promoteIfReady 가 자동 승격한다.
 * 예전에는 ACTIVE 를 먼저 반영해 번역 중 중국어 원본이 손님에게 보였다.
 */
async function requestPublish(id: string): Promise<{ state: "active" | "pending"; why: string }> {
  // 판매 의사 표시 시점에 이름부터 정리 — 수집 때 번역이 실패해 중국어 원문이
  // 남은 상품이 그 이름 그대로 손님에게 나가지 않게 (실패해도 판매는 안 막는다)
  await ensureKoreanName(id).catch(() => {});
  const p = await db.product.findUnique({
    where: { id },
    select: { sourceUrl: true, brand: true },
  });
  const needsTranslation = sourceForUrl(p?.sourceUrl ?? "")?.translate === true;
  const assets = needsTranslation
    ? await db.productAsset.findMany({
        where: { productId: id },
        select: { translateStatus: true, originalUrl: true },
      })
    : [];
  // 브랜드 미정도 보류 사유다 — 목록의 판매중 토글은 폼 검증(validate)을 안 거쳐
  // 여기가 유일한 방어선이다
  const gate = productPublishGate(assets, needsTranslation, p?.brand);
  if (!gate.ready) {
    await db.product.update({
      where: { id },
      data: { status: "HIDDEN", publishRequestedAt: new Date() },
    });
    await translateOnPublish(id);
    // 사유를 그대로 실어 보낸다 — "번역 검증 대기"로 뭉뚱그리면 브랜드가 비어서
    // 막힌 상품을 운영자가 번역 끝나기만 기다리게 된다 (영원히 안 풀린다)
    return { state: "pending", why: gateSummary(gate) };
  }
  await db.product.update({ where: { id }, data: { status: "ACTIVE", publishRequestedAt: null } });
  await translateOnPublish(id);
  return { state: "active", why: "" };
}

export async function setProductStatus(id: string, status: "ACTIVE" | "HIDDEN"): Promise<void> {
  await requireAdmin();
  const p = await db.product.findUnique({ where: { id }, select: { name: true } });
  let summary: string;
  if (status === "ACTIVE") {
    const r = await requestPublish(id);
    summary = `${p?.name ?? id} → ${r.state === "active" ? "판매중" : `판매 보류(${r.why || "검증 대기"})`}`;
  } else {
    await db.product.update({ where: { id }, data: { status, publishRequestedAt: null } });
    summary = `${p?.name ?? id} → 숨김`;
  }
  await audit({
    action: "PRODUCT_STATUS",
    target: "product",
    targetId: id,
    summary,
  });
  revalidatePath("/admin/products");
  revalidatePath(`/products/${id}`);
}

/**
 * 목록에서 브랜드만 바로 입력한다.
 *
 * 수집 상품은 브랜드를 모른 채 들어오는데(1688 공장 상품은 브랜드가 아예 없다),
 * 수백 건을 상품마다 수정 폼을 열어 채우는 건 현실적이지 않다. 목록에서 바로
 * 치고 엔터만 누르면 되게 한다.
 *
 * 브랜드를 채우면 브랜드 때문에 보류돼 있던 상품은 여기서 바로 승격을 시도한다
 * — 안 그러면 운영자가 "판매" 버튼을 한 번 더 눌러야 하는지 알 수 없다.
 */
export async function setProductBrand(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const brand = String(formData.get("brand") ?? "").trim();
  // 빈 값·"미정"으로 되돌리는 건 저장하지 않는다 — 실수로 지우고 엔터를 쳐도
  // 이미 채워둔 브랜드가 날아가지 않는다
  if (isPlaceholderBrand(brand)) return;
  const before = await db.product.findUnique({ where: { id }, select: { brand: true, name: true } });
  if (!before || before.brand === brand) return;
  await db.product.update({ where: { id }, data: { brand } });
  await audit({
    action: "PRODUCT_UPDATE",
    target: "product",
    targetId: id,
    summary: `${before.name} 브랜드 → ${brand}`,
    meta: { before: before.brand, after: brand },
  });
  await promoteIfReady(id);
  revalidatePath("/admin/products");
  revalidatePath(`/products/${id}`);
}

export async function deleteProduct(id: string): Promise<void> {
  await requireAdmin();
  // 업로드 이미지를 함께 정리하지 않으면 디스크에 고아 파일이 계속 쌓인다.
  const product = await db.product.findUnique({ where: { id }, select: { image: true, name: true } });
  await db.product.delete({ where: { id } });
  // 상품이 지워지면 자산도 cascade 로 사라지므로 썸네일 파일은 그대로 정리한다
  if (product?.image) await deleteImageUpload(product.image);
  await audit({
    action: "PRODUCT_DELETE",
    target: "product",
    targetId: id,
    summary: `${product?.name ?? id} 삭제`,
  });
  revalidatePath("/admin/products");
  revalidatePath("/");
}
