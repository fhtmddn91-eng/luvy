-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "image" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "imageMobile" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "HomeSection" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'AUTO_NEW',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HomeSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomePick" (
    "sectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HomePick_pkey" PRIMARY KEY ("sectionId","productId")
);

-- CreateIndex
CREATE INDEX "HomePick_sectionId_idx" ON "HomePick"("sectionId");

-- AddForeignKey
ALTER TABLE "HomePick" ADD CONSTRAINT "HomePick_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "HomeSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomePick" ADD CONSTRAINT "HomePick_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

