UPDATE "User"
SET "email_verified_at" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT ur."user_id"
  FROM "UserRole" ur
  JOIN "Role" r ON r."id" = ur."role_id"
  WHERE r."code" = 'CUSTOMER'
);

UPDATE "RefreshToken"
SET "revoked_at" = CURRENT_TIMESTAMP
WHERE "revoked_at" IS NULL
  AND "user_id" IN (
    SELECT ur."user_id"
    FROM "UserRole" ur
    JOIN "Role" r ON r."id" = ur."role_id"
    WHERE r."code" = 'CUSTOMER'
  );

UPDATE "EmailVerification"
SET "consumed_at" = CURRENT_TIMESTAMP
WHERE "consumed_at" IS NULL
  AND "user_id" IN (
    SELECT ur."user_id"
    FROM "UserRole" ur
    JOIN "Role" r ON r."id" = ur."role_id"
    WHERE r."code" = 'CUSTOMER'
  );
