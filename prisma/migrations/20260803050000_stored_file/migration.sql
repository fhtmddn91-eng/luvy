-- CreateTable
CREATE TABLE "StoredFile" (
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'public',
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("name")
);

