-- AlterTable
ALTER TABLE "products" ADD COLUMN "rank_name" VARCHAR(32);

-- CreateTable
CREATE TABLE "uploaded_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mime" VARCHAR(32) NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_images_pkey" PRIMARY KEY ("id")
);
