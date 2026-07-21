-- DropIndex
DROP INDEX "AiMessage_chatId_createdAt_idx";

-- AlterTable
ALTER TABLE "AiMessage" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "AiMessage_chatId_seq_idx" ON "AiMessage"("chatId", "seq");
