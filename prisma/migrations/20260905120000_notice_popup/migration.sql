-- 공지 팝업 — 추가만, 파괴 없음
-- 기존 공지는 popup = false 로 남아 지금처럼 하단 스트립에만 나온다.

-- AlterTable
ALTER TABLE "Notice" ADD COLUMN "popup" BOOLEAN NOT NULL DEFAULT false;
