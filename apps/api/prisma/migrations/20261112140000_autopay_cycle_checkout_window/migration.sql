-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "checkoutExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "renewalCycle" "BillingCycle";

