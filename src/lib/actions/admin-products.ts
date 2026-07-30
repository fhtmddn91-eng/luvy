"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveImageUpload, deleteImageUpload } from "@/lib/storage";

export type ProductFormState = { error?: string };

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
    description: String(formData.get("description") ?? "").trim(),
    basePrice: parseInt(String(formData.get("basePrice") ?? "0"), 10) || 0,
    status: String(formData.get("status") ?? "ACTIVE"),
    trackStock: formData.get("trackStock") === "on",
    stock: Math.max(0, parseInt(String(formData.get("stock") ?? "0"), 10) || 0),
  };
}

function validate(f: ReturnType<typeof parseFields>, tiers: { minQty: number }[]): string | null {
  if (!f.name) return "상품명을 입력해주세요.";
  if (!f.brand) return "브랜드를 입력해주세요.";
  if (!f.categorySlug) return "카테고리를 선택해주세요.";
  if (f.basePrice <= 0) return "정가를 올바르게 입력해주세요.";
  if (tiers.length === 0) return "수량별 도매가를 최소 1개 입력해주세요.";
  return null;
}

export async function createProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  await requireAdmin();
  const fields = parseFields(formData);
  const tiers = parseTiers(formData);
  const err = validate(fields, tiers);
  if (err) return { error: err };

  const image = await handleImage(formData);
  if ("error" in image) return { error: image.error };

  const created = await db.product.create({
    data: { ...fields, image: image.url ?? "", priceTiers: { create: tiers } },
  });
  await audit({
    action: "PRODUCT_CREATE",
    target: "product",
    targetId: created.id,
    summary: `${created.name} 등록 (${created.status === "ACTIVE" ? "판매중" : "숨김"})`,
    meta: { tiers: tiers.length },
  });
  revalidatePath("/admin/products");
  revalidatePath("/");
  redirect("/admin/products");
}

export async function updateProduct(id: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  await requireAdmin();
  const fields = parseFields(formData);
  const tiers = parseTiers(formData);
  const err = validate(fields, tiers);
  if (err) return { error: err };

  const image = await handleImage(formData);
  if ("error" in image) return { error: image.error };

  // 새 이미지가 업로드되면 이전 업로드 파일은 정리
  if (image.url) {
    const prev = await db.product.findUnique({ where: { id }, select: { image: true } });
    if (prev?.image) await deleteImageUpload(prev.image);
  }

  await db.$transaction([
    db.priceTier.deleteMany({ where: { productId: id } }),
    db.product.update({
      where: { id },
      data: { ...fields, ...(image.url ? { image: image.url } : {}), priceTiers: { create: tiers } },
    }),
  ]);
  await audit({
    action: "PRODUCT_UPDATE",
    target: "product",
    targetId: id,
    summary: `${fields.name} 수정`,
    meta: { status: fields.status, trackStock: fields.trackStock, stock: fields.stock, tiers: tiers.length },
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
