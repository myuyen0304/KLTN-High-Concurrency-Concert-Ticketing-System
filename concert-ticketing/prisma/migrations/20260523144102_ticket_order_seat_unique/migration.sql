-- CreateIndex
CREATE UNIQUE INDEX "tickets_orderId_seatId_key" ON "tickets"("orderId", "seatId");
