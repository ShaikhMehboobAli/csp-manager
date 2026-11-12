-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'ACTIVATION_REVOKE_REQUESTED';
ALTER TYPE "NotificationKind" ADD VALUE 'ACTIVATION_REVOKE_APPROVED';
ALTER TYPE "NotificationKind" ADD VALUE 'ACTIVATION_REVOKE_REJECTED';
ALTER TYPE "NotificationKind" ADD VALUE 'ACTIVATION_REVOKED';
ALTER TYPE "NotificationKind" ADD VALUE 'BC_LINK_REQUESTED';
ALTER TYPE "NotificationKind" ADD VALUE 'BC_LINK_APPROVED';
ALTER TYPE "NotificationKind" ADD VALUE 'BC_LINK_REJECTED';
ALTER TYPE "NotificationKind" ADD VALUE 'BC_LINKED';
ALTER TYPE "NotificationKind" ADD VALUE 'CASH_SETTLEMENT_STARTED';
ALTER TYPE "NotificationKind" ADD VALUE 'CASH_SETTLEMENT_COMPLETED';
ALTER TYPE "NotificationKind" ADD VALUE 'CASH_SETTLEMENT_CANCELLED';
ALTER TYPE "NotificationKind" ADD VALUE 'CASH_DAY_CLOSE_DIFFERENCE';
ALTER TYPE "NotificationKind" ADD VALUE 'CASH_REQUEST_RAISED';
ALTER TYPE "NotificationKind" ADD VALUE 'RECEIPT_REPORT_RAISED';
ALTER TYPE "NotificationKind" ADD VALUE 'RECEIPT_REPORT_RESOLVED';
ALTER TYPE "NotificationKind" ADD VALUE 'RECEIPT_REPORT_REJECTED';

