-- DropIndex
DROP INDEX "tickets_seatId_key";

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_locks" ADD CONSTRAINT "seat_locks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
