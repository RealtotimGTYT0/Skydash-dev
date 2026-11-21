-- CreateTable
CREATE TABLE "ranks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "grant_commands" TEXT[],
    "revoke_commands" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_ranks" (
    "mc_account_id" UUID NOT NULL,
    "rank_id" UUID NOT NULL,
    "granted_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_ranks_pkey" PRIMARY KEY ("mc_account_id","rank_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ranks_name_key" ON "ranks"("name");

-- CreateIndex
CREATE INDEX "account_ranks_rank_id_idx" ON "account_ranks"("rank_id");

-- AddForeignKey
ALTER TABLE "account_ranks" ADD CONSTRAINT "account_ranks_mc_account_id_fkey" FOREIGN KEY ("mc_account_id") REFERENCES "minecraft_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ranks" ADD CONSTRAINT "account_ranks_rank_id_fkey" FOREIGN KEY ("rank_id") REFERENCES "ranks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
