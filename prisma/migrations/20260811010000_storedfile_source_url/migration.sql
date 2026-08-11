-- 미러링 원본 주소를 기억해 같은 원격 이미지를 두 번 받지 않는다
ALTER TABLE "StoredFile" ADD COLUMN "sourceUrl" TEXT;

CREATE INDEX "StoredFile_sourceUrl_idx" ON "StoredFile"("sourceUrl");
