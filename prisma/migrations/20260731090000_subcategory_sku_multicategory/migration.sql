-- 세부 카테고리(2단) + 상품 품번 + 상품 다중 카테고리

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "parentSlug" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "sku" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "ProductCategory" (
    "productId" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId","categorySlug")
);

-- CreateIndex
CREATE INDEX "ProductCategory_categorySlug_idx" ON "ProductCategory"("categorySlug");

-- CreateIndex
CREATE INDEX "Category_parentSlug_idx" ON "Category"("parentSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categorySlug_fkey" FOREIGN KEY ("categorySlug") REFERENCES "Category"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentSlug_fkey" FOREIGN KEY ("parentSlug") REFERENCES "Category"("slug") ON DELETE SET NULL ON UPDATE CASCADE;

-- 백필: 기존 상품의 대표 카테고리를 조인 테이블에도 넣는다.
-- 이걸 빼먹으면 매장 카테고리 목록이 전부 0개로 보인다.
-- 카테고리 테이블에 없는 slug 를 가진 상품은 FK 위반이 나므로 JOIN 으로 걸러낸다.
INSERT INTO "ProductCategory" ("productId", "categorySlug")
SELECT p."id", p."categorySlug"
FROM "Product" p
JOIN "Category" c ON c."slug" = p."categorySlug"
ON CONFLICT DO NOTHING;
