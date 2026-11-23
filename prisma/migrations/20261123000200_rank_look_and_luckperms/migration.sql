-- AlterTable
ALTER TABLE "ranks" ADD COLUMN "animated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lp_group" VARCHAR(64);

-- The staff ranks are linked to a LuckPerms group with the same name (create the groups with /lp creategroup <name>).
UPDATE "ranks" SET "lp_group" = "name"
 WHERE "lp_group" IS NULL
   AND "name" IN ('helper','head-helper','mod','head-mod','staff','head-staff','admin','head-admin','dev','owner','founder','realtotim');

-- The two top ranks start animated.
UPDATE "ranks" SET "animated" = true WHERE "name" IN ('founder','realtotim');
