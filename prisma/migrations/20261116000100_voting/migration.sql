-- CreateTable
CREATE TABLE "vote_sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_name" VARCHAR(64) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mc_account_id" UUID NOT NULL,
    "service_name" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "tokens_awarded" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vote_sites_service_name_key" ON "vote_sites"("service_name");

-- CreateIndex
CREATE UNIQUE INDEX "vote_records_idempotency_key_key" ON "vote_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "vote_records_mc_account_id_service_name_created_at_idx" ON "vote_records"("mc_account_id", "service_name", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_mc_account_id_fkey" FOREIGN KEY ("mc_account_id") REFERENCES "minecraft_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_tokens_nonneg" CHECK ("tokens_awarded" >= 0);
