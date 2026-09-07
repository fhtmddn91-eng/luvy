-- 등급·회원별 할인율 (2026-09-08)
--
-- 전부 추가만 한다. 마이그레이션은 배포 부팅 중에 돌아서(prisma migrate deploy),
-- 실패하면 서비스가 아예 안 뜬다. 기존 컬럼을 건드리지 않는다.
--
-- 기본값이 전부 0/NULL 이므로 적용 직후 모든 회원의 할인은 0% 다 —
-- 운영자가 관리자에서 값을 넣기 전까지 금액이 한 푼도 바뀌지 않는다.

-- 등급 기본 할인율 (만분율: 500 = 5%)
ALTER TABLE "MemberGrade" ADD COLUMN "discountBp" INTEGER NOT NULL DEFAULT 0;

-- 회원 개별 할인율. NULL = 등급을 따름 (0 = "이 거래처는 할인 없음"과 구분한다)
ALTER TABLE "User" ADD COLUMN "discountBp" INTEGER;

-- 주문 스냅샷 — 나중에 할인율이 바뀌어도 그때 얼마에 팔았는지 남아야 한다
ALTER TABLE "Order" ADD COLUMN "discountBp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "listPrice" INTEGER NOT NULL DEFAULT 0;
