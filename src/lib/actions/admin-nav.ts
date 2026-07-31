"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type NavFormState = { error?: string; ok?: boolean };

/** 헤더는 모든 페이지에 있으므로 레이아웃째로 갱신한다 */
function revalidateNav(): void {
  revalidatePath("/", "layout");
}

/** 내부 경로만 허용 — 외부 주소를 상단 메뉴에 넣어 피싱에 쓰이는 걸 막는다 */
const isInternalPath = (href: string) =>
  href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");

export async function createNavLink(
  _prev: NavFormState,
  formData: FormData,
): Promise<NavFormState> {
  await requireAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const href = String(formData.get("href") ?? "").trim();
  const badge = String(formData.get("badge") ?? "").trim();

  if (!label) return { error: "메뉴 이름을 입력해주세요." };
  if (!isInternalPath(href)) {
    return { error: "링크는 / 로 시작하는 사이트 내부 주소여야 합니다. 예) /new" };
  }

  const last = await db.navLink.aggregate({ _max: { sortOrder: true } });
  await db.navLink.create({
    data: {
      label: label.slice(0, 20),
      href: href.slice(0, 200),
      badge: badge.slice(0, 6),
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    },
  });

  await audit({ action: "NAV_UPDATE", target: "nav", summary: `메뉴 추가: ${label}` });
  revalidateNav();
  return { ok: true };
}

export async function updateNavLink(
  id: string,
  _prev: NavFormState,
  formData: FormData,
): Promise<NavFormState> {
  await requireAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const href = String(formData.get("href") ?? "").trim();
  const badge = String(formData.get("badge") ?? "").trim();

  if (!label) return { error: "메뉴 이름을 입력해주세요." };
  if (!isInternalPath(href)) {
    return { error: "링크는 / 로 시작하는 사이트 내부 주소여야 합니다. 예) /new" };
  }

  await db.navLink.update({
    where: { id },
    data: { label: label.slice(0, 20), href: href.slice(0, 200), badge: badge.slice(0, 6) },
  });

  await audit({ action: "NAV_UPDATE", target: "nav", targetId: id, summary: `메뉴 수정: ${label}` });
  revalidateNav();
  return { ok: true };
}

export async function toggleNavLink(id: string): Promise<void> {
  await requireAdmin();
  const item = await db.navLink.findUnique({ where: { id } });
  if (!item) return;
  await db.navLink.update({ where: { id }, data: { active: !item.active } });
  await audit({
    action: "NAV_UPDATE",
    target: "nav",
    targetId: id,
    summary: `메뉴 ${item.label} → ${item.active ? "숨김" : "노출"}`,
  });
  revalidateNav();
}

export async function deleteNavLink(id: string): Promise<void> {
  await requireAdmin();
  const item = await db.navLink.findUnique({ where: { id } });
  await db.navLink.delete({ where: { id } });
  await audit({
    action: "NAV_UPDATE",
    target: "nav",
    targetId: id,
    summary: `메뉴 삭제: ${item?.label ?? id}`,
  });
  revalidateNav();
}

/** 위/아래 한 칸 이동 — 이웃과 sortOrder 를 맞바꾼다 */
export async function moveNavLink(id: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const all = await db.navLink.findMany({ orderBy: { sortOrder: "asc" } });
  const i = all.findIndex((n) => n.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;

  await db.$transaction([
    db.navLink.update({ where: { id: all[i].id }, data: { sortOrder: all[j].sortOrder } }),
    db.navLink.update({ where: { id: all[j].id }, data: { sortOrder: all[i].sortOrder } }),
  ]);
  revalidateNav();
}

/**
 * 기존 하드코딩 메뉴를 DB 로 한 번 옮긴다 (비어 있을 때만).
 * 관리자가 "기본값 불러오기" 를 눌러 시작점을 얻는 용도.
 */
export async function seedDefaultNavLinks(): Promise<void> {
  await requireAdmin();
  if ((await db.navLink.count()) > 0) return;

  const { FALLBACK_NAV } = await import("@/lib/navLinks");
  await db.navLink.createMany({
    data: FALLBACK_NAV.map((n, i) => ({ ...n, sortOrder: i })),
  });
  await audit({ action: "NAV_UPDATE", target: "nav", summary: "기본 메뉴 불러오기" });
  revalidateNav();
}
