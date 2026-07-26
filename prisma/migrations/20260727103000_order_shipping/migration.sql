-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "courier" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "trackingNo" TEXT NOT NULL DEFAULT '';

