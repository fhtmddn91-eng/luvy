"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { saveImageUpload, deleteImageUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";

export type AssetFormState = { error?: string; ok?: number };

function revalidateProduct(productId: string): void {
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/products/${productId}`);
}

/**
 * 상세페이지 이미지/GIF 업로드 (여러 장 한 번에).
 * GIF 는 kind=GIF, 나머지는 kind=DETAIL 로 저장되어 상품 상세 하단에 순서대로 렌더된다.
 */
export async function addProductAssets(
  productId: string,
  _prev: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  await requireAdmin();

  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return { error: "상품을 찾을 수 없습니다." };

  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "업로드할 파일을 선택해주세요." };
  if (files.length > 30) return { error: "한 번에 30장까지 올릴 수 있습니다." };

  const last = await db.productAsset.aggregate({
    where: { productId },
    _max: { sortOrder: true },
  });
  let order = (last._max.sortOrder ?? -1) + 1;

  let saved = 0;
  for (const file of files) {
    const result = await saveImageUpload(file);
    if (!result.ok) {
      // 일부만 실패해도 이미 저장된 것은 남긴다 — 몇 번째 파일이 왜 안 됐는지 알려준다
      return {
        error: `'${file.name}' 업로드 실패: ${result.error}${saved > 0 ? ` (앞의 ${saved}장은 저장됨)` : ""}`,
        ok: saved || undefined,
      };
    }
    await db.productAsset.create({
      data: {
        productId,
        kind: file.type === "image/gif" ? "GIF" : "DETAIL",
        url: result.url,
        bytes: file.size,
        sortOrder: order++,
      },
    });
    saved++;
  }

  await audit({
    action: "ASSET_ADD",
    target: "product",
    targetId: productId,
    summary: `상세 이미지 ${saved}장 추가`,
  });
  revalidateProduct(productId);
  return { ok: saved };
}

export async function deleteProductAsset(assetId: string): Promise<void> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  await db.productAsset.delete({ where: { id: assetId } });
  // /uploads/ 파일도 정리 (1688 수집분 등 다른 경로면 deleteImageUpload 가 무시)
  await deleteImageUpload(asset.url);
  await audit({
    action: "ASSET_DELETE",
    target: "product",
    targetId: asset.productId,
    summary: `상세 이미지 1장 삭제 (${asset.kind})`,
    meta: { url: asset.url },
  });
  revalidateProduct(asset.productId);
}

/** 상세 이미지 순서 한 칸 이동 — 이웃과 sortOrder 를 맞바꾼다 */
export async function moveProductAsset(assetId: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;

  const siblings = await db.productAsset.findMany({
    where: { productId: asset.productId },
    orderBy: { sortOrder: "asc" },
  });
  const i = siblings.findIndex((a) => a.id === assetId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return;

  await db.$transaction([
    db.productAsset.update({ where: { id: siblings[i].id }, data: { sortOrder: siblings[j].sortOrder } }),
    db.productAsset.update({ where: { id: siblings[j].id }, data: { sortOrder: siblings[i].sortOrder } }),
  ]);
  revalidateProduct(asset.productId);
}
