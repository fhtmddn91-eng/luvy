-- 포인트 사용·만료·자동 승급 (2026-09-05) — 전부 추가만, 파괴 없음
-- 앞 마이그레이션(회원 등급·포인트)과 같은 배포에 나가므로 기존 원장 행은 없지만,
-- 있더라도 양수 행의 remaining 을 amount 로 채워 불변식(Σremaining == 잔액)을 지킨다.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "pointsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "gradeLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MemberGrade" ADD COLUMN "threshold" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PointLedger" ADD COLUMN "remaining" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "PointLedger" SET "remaining" = "amount" WHERE "amount" > 0;

-- CreateIndex
CREATE INDEX "PointLedger_expiresAt_remaining_idx" ON "PointLedger"("expiresAt", "remaining");
