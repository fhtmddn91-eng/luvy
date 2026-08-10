"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveImageUpload, deleteImageUpload } from "@/lib/storage";
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
async function handleImage(formData: FormData): Promise<{ url?: string } | { error: string }> {
  const file = formData.get("imageFile");
  if (!(file instanceof File) || file.size === 0) return {};
  const saved = await saveImageUpload(file);
  if (!saved.ok) return { error: saved.error };
  return { url: saved.url };
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

  // 새 이미지가 업로드되면 이전 업로드 파일은 정리
  if (image.url) {
    const prev = await db.product.findUnique({ where: { id }, select: { image: true } });
    if (prev?.image) await deleteImageUpload(prev.image);
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
        ...(image.url ? { image: image.url } : {}),
        priceTiers: { create: tiers },
        categories: { create: cats },
      },
    }),
  ]);
  await syncOptions(id, parseOptions(formData));
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
  redirect("/admin/products");
}

export async function setProductStatus(id: string, status: "ACTIVE" | "HIDDEN"): Promise<void> {
  await requireAdmin();
  const p = await db.product.findUnique({ where: { id }, select: { name: true } });
  await db.product.update({ where: { id }, data: { status } });
  await audit({
    action: "PRODUCT_STATUS",
    target: "product",
    targetId: id,
    summary: `${p?.name ?? id} → ${status === "ACTIVE" ? "판매중" : "숨김"}`,
  });
  revalidatePath("/admin/products");
  revalidatePath(`/products/${id}`);
}

export async function deleteProduct(id: string): Promise<void> {
  await requireAdmin();
  // 업로드 이미지를 함께 정리하지 않으면 디스크에 고아 파일이 계속 쌓인다.
  const product = await db.product.findUnique({ where: { id }, select: { image: true, name: true } });
  await db.product.delete({ where: { id } });
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
