-- 무통장 입금 확인 기록 — 전부 추가만, 파괴 없음
-- 기존 주문은 depositConfirmedAt = NULL 로 남는다. 상태 전이 검사는 RECEIVED 를
-- 떠날 때만 하므로, 이미 배송준비 이상인 옛 주문의 송장 입력이 잠기지 않는다.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "depositConfirmedAt" TIMESTAMP(3),
ADD COLUMN "depositConfirmedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN "depositorName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "depositAmount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Order_paymentMethod_status_depositConfirmedAt_idx" ON "Order"("paymentMethod", "status", "depositConfirmedAt");
