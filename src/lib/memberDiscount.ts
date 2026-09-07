import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { effectiveDiscountBp } from "@/lib/discount";

/**
 * 로그인한 회원에게 적용할 할인율 조회 (2026-09-08).
 *
 * **화면과 주문서가 같은 값을 보게 하는 것이 이 파일의 존재 이유다.** 상품카드가
 * 회원가를 보여줬는데 주문서가 정가로 계산하면(혹은 그 반대면) 손님이 본 금액과
 * 청구액이 갈린다. 그래서 조회 경로를 여기 하나로 모은다.
 *
 * `cache` 는 **요청 한 번 안에서만** 유효하다. 상품 카드가 40개 있어도 질의는
 * 한 번이고, 다음 요청에서는 다시 읽는다 — 관리자가 방금 바꾼 할인율이
 * 다음 새로고침에 바로 반영되어야 하므로 그 이상 오래 들고 있으면 안 된다.
 */
export const getMemberDiscountBp = cache(async (userId: string): Promise<number> => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { discountBp: true, grade: { select: { discountBp: true } } },
  });
  if (!user) return 0;
  return effectiveDiscountBp(user.discountBp, user.grade.discountBp);
});

/**
 * 현재 세션 회원의 할인율. 비로그인·조회 실패는 0(정가).
 *
 * 화면이 회원을 따로 넘겨받지 않아도 되게 세션에서 바로 읽는다 —
 * 목록 페이지마다 user 를 끌고 다니다 한 곳을 빠뜨리면 그 화면만 정가가 된다.
 */
export const currentDiscountBp = cache(async (): Promise<number> => {
  const user = await getSession();
  return user ? getMemberDiscountBp(user.id) : 0;
});
