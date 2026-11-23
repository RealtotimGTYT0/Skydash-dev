-- AlterTable
ALTER TABLE "minecraft_accounts" ADD COLUMN "lb_hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lb_banned" BOOLEAN NOT NULL DEFAULT false;
