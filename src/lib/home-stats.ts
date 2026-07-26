import "server-only";
import { db } from "./db";

export type HomeStatRow = {
  icon: string;
  label: string;
  value: string;
  hot?: boolean;
};

/**
 * 메인 회원 위젯 / 로그인 환영 팝업이 공유하는 요약 통계.
 * 두 곳이 서로 다른 숫자를 보여주지 않도록 한 곳에서 계산한다.
 */
export async function getHomeStats(): Promise<HomeStatRow[]> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [todayCount, newCount, activeCount, reorderCount] = await Promise.all([
    db.product.count({ where: { status: "ACTIVE", createdAt: { gte: dayStart } } }),
    db.product.count({ where: { status: "ACTIVE", createdAt: { gte: weekAgo } } }),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.orderItem.groupBy({ by: ["productId"] }).then((g) => g.length),
  ]);

  return [
    { icon: "sparkle", label: "오늘 업데이트", value: `${todayCount}개`, hot: todayCount > 0 },
    { icon: "bag", label: "신상품", value: `${newCount}개` },
    { icon: "verified", label: "많이 팔리는 상품", value: "TOP 100" },
    { icon: "heart", label: "재구매 높은 상품", value: `${reorderCount || activeCount}개` },
  ];
}
