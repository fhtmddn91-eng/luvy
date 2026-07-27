-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "canceledBy" TEXT NOT NULL DEFAULT '';

