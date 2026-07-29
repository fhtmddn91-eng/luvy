-- CreateTable
CREATE TABLE "Category" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'sparkle',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("slug")
);


-- 기존에 코드에 박혀 있던 8개 카테고리를 데이터로 이관
-- (운영 서버도 migrate deploy 만으로 같은 목록을 갖게 하기 위한 데이터 마이그레이션)
INSERT INTO "Category" ("slug", "name", "icon", "sortOrder", "active") VALUES
  ('women',          '여성용품',      'user',      0, true),
  ('men',            '남성용품',      'userRound', 1, true),
  ('couple-sm',      '커플 & SM',     'heart',     2, true),
  ('anal',           '애널용품',      'sparkle',   3, true),
  ('massage-lotion', '마사지 & 로션', 'hand',      4, true),
  ('condom-lube',    '콘돔 & 윤활제', 'droplet',   5, true),
  ('idea',           '아이디어 상품', 'lightbulb', 6, true),
  ('brand',          '브랜드관',      'store',     7, true)
ON CONFLICT ("slug") DO NOTHING;
