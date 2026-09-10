-- 배송 주소 분리 — 우편번호·상세주소 (2026-09-10)
--
-- 추가만 한다. 마이그레이션은 배포 부팅 중에 돌아서(prisma migrate deploy),
-- 실패하면 서비스가 아예 안 뜬다. 기존 address 컬럼은 건드리지 않는다.
--
-- 기존 주문은 두 칸이 빈 문자열이 된다. 화면은 lib/address.ts 의 fullAddress 가
-- 빈 조각을 접으므로 "() 청주" 같은 빈 괄호가 남지 않는다.

ALTER TABLE "Order" ADD COLUMN "postcode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "addressDetail" TEXT NOT NULL DEFAULT '';
