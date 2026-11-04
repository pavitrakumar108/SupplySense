ALTER TABLE "User"
  ALTER COLUMN "password_hash" DROP NOT NULL,
  ADD COLUMN "google_sub" VARCHAR(255),
  ADD COLUMN "email_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "User_google_sub_key" ON "User"("google_sub");

CREATE TABLE "EmailVerification" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailVerification_user_id_consumed_at_expires_at_idx"
  ON "EmailVerification"("user_id", "consumed_at", "expires_at");

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustomerFeedback" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "name" VARCHAR(160) NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "subject" VARCHAR(160) NOT NULL,
  "message" TEXT NOT NULL,
  "rating" INTEGER,
  "is_resolved" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerFeedback_is_resolved_created_at_idx"
  ON "CustomerFeedback"("is_resolved", "created_at");

ALTER TABLE "CustomerFeedback"
  ADD CONSTRAINT "CustomerFeedback_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
