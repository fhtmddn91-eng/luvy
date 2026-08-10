-- 상품 옵션 (색상·사이즈). 옵션별 단가·재고를 따로 관리한다
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL DEFAULT 0,
    "trackStock" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductOption_productId_idx" ON "ProductOption"("productId");

ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 장바구니: 옵션별로 줄이 나뉜다. 옵션 없는 상품은 빈 문자열
ALTER TABLE "CartItem" ADD COLUMN "optionId" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "CartItem_userId_productId_key";
CREATE UNIQUE INDEX "CartItem_userId_productId_optionId_key" ON "CartItem"("userId", "productId", "optionId");

-- 주문서에는 옵션명을 스냅샷으로 남긴다 (옵션이 지워져도 주문 기록은 유지)
ALTER TABLE "OrderItem" ADD COLUMN "optionName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrderItem" ADD COLUMN "optionId" TEXT NOT NULL DEFAULT '';
