-- Passbook prints uploaded before PASSBOOK / PASSBOOK_PRINTING existed came in
-- as UNKNOWN / OTHER with transactionType "Passbook Printing".
UPDATE "public"."Receipt"
SET "receiptType" = 'PASSBOOK',
    "transactionCategory" = 'PASSBOOK_PRINTING'
WHERE "transactionType" = 'Passbook Printing'
  AND "receiptType" = 'UNKNOWN'
  AND "transactionCategory" = 'OTHER';
