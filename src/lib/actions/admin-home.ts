"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isHomeMode, DEFAULT_SECTIONS } from "@/lib/homeSections";

export type HomeSectionState = { error?: string; ok?: boolean };

function revalidate(): void {
  revalidatePath("/");
  revalidatePath("/admin/home");
}

/** 관리자가 아직 아무것도 설정하지 않았을 때 기본 4탭을 DB 에 만들어준다 */
export async function seedDefaultSections(): Promise<void> {
  await requireAdmin();
  if ((await db.homeSection.count()) > 0) return;
  await db.homeSection.createMany({
    data: DEFAULT_SECTIONS.map((s, i) => ({ label: s.label, mode: s.mode, sortOrder: i })),
  });
  await audit({ action: "HOME_UPDATE", target: "home", summary: "기본 상품 탭 생성" });
  revalidate();
}

export async function createSection(
  _prev: HomeSectionState,
  formData: FormData,
): Promise<HomeSectionState> {
  await requireAdmin();
  const label = String(formData.get("label") ?? "").trim();
  const mode = String(formData.get("mode") ?? "");
  if (!label) return { error: "탭 이름을 입력해주세요." };
  if (!isHomeMode(mode)) return { error: "표시 방식을 선택해주세요." };

  const last = await db.homeSection.aggregate({ _max: { sortOrder: true } });
  await db.homeSection.create({
    data: { label: label.slice(0, 20), mode, sortOrder: (last._max.sortOrder ?? -1) + 1 },
  });
  await audit({ action: "HOME_UPDATE", target: "home", summary: `상품 탭 ${label} 추가` });
  revalidate();
  return { ok: true };
}

export async function updateSection(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const label = String(formData.get("label") ?? "").trim();
  const mode = String(formData.get("mode") ?? "");
  if (!label || !isHomeMode(mode)) return;
  await db.homeSection.update({
    where: { id },
    data: { label: label.slice(0, 20), mode },
  });
  await audit({ action: "HOME_UPDATE", target: "home", targetId: id, summary: `상품 탭 ${label} 수정` });
  revalidate();
}

export async function toggleSection(id: string): Promise<void> {
  await requireAdmin();
  const s = await db.homeSection.findUnique({ where: { id } });
  if (!s) return;
  await db.homeSection.update({ where: { id }, data: { active: !s.active } });
  revalidate();
}

export async function moveSection(id: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const all = await db.homeSection.findMany({ orderBy: { sortOrder: "asc" } });
  const i = all.findIndex((s) => s.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  await db.$transaction([
    db.homeSection.update({ where: { id: all[i].id }, data: { sortOrder: all[j].sortOrder } }),
    db.homeSection.update({ where: { id: all[j].id }, data: { sortOrder: all[i].sortOrder } }),
  ]);
  revalidate();
}

export async function deleteSection(id: string): Promise<void> {
  await requireAdmin();
  const s = await db.homeSection.findUnique({ where: { id }, select: { label: true } });
  await db.homeSection.delete({ where: { id } });
  await audit({ action: "HOME_UPDATE", target: "home", targetId: id, summary: `상품 탭 ${s?.label ?? id} 삭제` });
  revalidate();
}

/**
 * 직접 고르기 탭에 상품 추가. 품번이나 상품명으로 찾는다 —
 * 관리자가 상품 id 를 외우고 있을 리 없다.
 */
export async function addPick(sectionId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const q = String(formData.get("q") ?? "").trim();
  if (!q) return;

  const product = await db.product.findFirst({
    where: {
      OR: [{ sku: q.toUpperCase() }, { name: { contains: q } }],
    },
    select: { id: true },
  });
  if (!product) return;

  const last = await db.homePick.aggregate({ where: { sectionId }, _max: { sortOrder: true } });
  await db.homePick.createMany({
    data: [{ sectionId, productId: product.id, sortOrder: (last._max.sortOrder ?? -1) + 1 }],
    skipDuplicates: true,
  });
  revalidate();
}

export async function removePick(sectionId: string, productId: string): Promise<void> {
  await requireAdmin();
  await db.homePick.delete({ where: { sectionId_productId: { sectionId, productId } } });
  revalidate();
}

export async function movePick(
  sectionId: string,
  productId: string,
  dir: "up" | "down",
): Promise<void> {
  await requireAdmin();
  const all = await db.homePick.findMany({ where: { sectionId }, orderBy: { sortOrder: "asc" } });
  const i = all.findIndex((p) => p.productId === productId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  await db.$transaction([
    db.homePick.update({
      where: { sectionId_productId: { sectionId, productId: all[i].productId } },
      data: { sortOrder: all[j].sortOrder },
    }),
    db.homePick.update({
      where: { sectionId_productId: { sectionId, productId: all[j].productId } },
      data: { sortOrder: all[i].sortOrder },
    }),
  ]);
  revalidate();
}
