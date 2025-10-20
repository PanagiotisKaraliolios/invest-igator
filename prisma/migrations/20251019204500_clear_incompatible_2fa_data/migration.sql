-- Clear existing 2FA data that uses incompatible format
-- Users will need to re-enable 2FA using Better Auth's native methods

DELETE FROM "twoFactor";

UPDATE "User" 
SET "twoFactorEnabled" = false 
WHERE "twoFactorEnabled" = true;
