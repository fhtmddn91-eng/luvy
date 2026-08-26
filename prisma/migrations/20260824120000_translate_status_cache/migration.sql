-- 번역 검증 상태·후보·해시 캐시 (설계 2026-08-24 v2.1) — 전부 추가만, 파괴 없음

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "publishRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProductAsset" ADD COLUMN "translateStatus" TEXT,
ADD COLUMN "reviewReasons" TEXT,
ADD COLUMN "candidateUrl" TEXT,
ADD COLUMN "candidateOcr" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "originalSha256" TEXT;

-- CreateTable
CREATE TABLE "TranslationCache" (
    "sha256" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ocrData" TEXT,
    "resultFile" TEXT,
    "verifyData" TEXT,
    "staleAt" TIMESTAMP(3),
    "staleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationCache_pkey" PRIMARY KEY ("sha256","pipelineVersion")
);

-- CreateIndex
CREATE INDEX "ProductAsset_translateStatus_idx" ON "ProductAsset"("translateStatus");

-- CreateIndex
CREATE INDEX "TranslationCache_resultFile_idx" ON "TranslationCache"("resultFile");

-- AddForeignKey
ALTER TABLE "TranslationCache" ADD CONSTRAINT "TranslationCache_resultFile_fkey" FOREIGN KEY ("resultFile") REFERENCES "StoredFile"("name") ON DELETE SET NULL ON UPDATE CASCADE;
