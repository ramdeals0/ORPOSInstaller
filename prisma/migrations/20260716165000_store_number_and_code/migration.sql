-- AlterTable
ALTER TABLE "Store" ADD COLUMN "storeNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Store_storeNumber_key" ON "Store"("storeNumber");

-- CreateIndex
CREATE INDEX "Store_storeNumber_idx" ON "Store"("storeNumber");
