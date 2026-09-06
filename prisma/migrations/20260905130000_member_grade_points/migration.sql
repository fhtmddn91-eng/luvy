-- 회원 등급·포인트 (운영자 요청서 1·2·3번, 2026-09-05) — 전부 추가만, 파괴 없음
-- 기존 회원은 BASIC(일반) 등급 · 잔액 0 으로 시작한다.

-- CreateTable
CREATE TABLE "MemberGrade" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pointRateBp" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MemberGrade_pkey" PRIMARY KEY ("code")
);

-- 기본 등급 3개. 이름·적립률은 어드민 설정에서 바꾼다.
INSERT INTO "MemberGrade" ("code", "name", "pointRateBp", "sortOrder") VALUES
    ('BASIC',  '일반', 0,   0),
    ('SILVER', '우수', 100, 1),
    ('GOLD',   'VIP',  200, 2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "gradeCode" TEXT NOT NULL DEFAULT 'BASIC',
ADD COLUMN "pointBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PointLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "orderId" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointLedger_orderId_kind_key" ON "PointLedger"("orderId", "kind");
CREATE INDEX "PointLedger_userId_createdAt_idx" ON "PointLedger"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_gradeCode_fkey" FOREIGN KEY ("gradeCode") REFERENCES "MemberGrade"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
