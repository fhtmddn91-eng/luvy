import "server-only";
import { db } from "@/lib/db";

/**
 * 찜 조회. 서버 컴포넌트에서만 쓰므로 "use server" 액션 파일과 분리했다 —
 * 액션 파일에 두면 화면에서 쓰지도 않는 조회 함수가 공개 엔드포인트가 된다.
 */
export async function isWished(userId: string, productId: string): Promise<boolean> {
  const row = await db.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { userId: true },
  });
  return row !== null;
}

export async function wishlistCount(userId: string): Promise<number> {
  return db.wishlist.count({ where: { userId } });
}
