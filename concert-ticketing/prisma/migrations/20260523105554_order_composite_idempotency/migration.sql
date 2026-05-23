-- DropIndex
DROP INDEX "orders_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "orders_userId_idempotencyKey_key" ON "orders"("userId", "idempotencyKey");
