CREATE TYPE "CheckoutPaymentMethod" AS ENUM ('UPI', 'CARD', 'COD');

ALTER TABLE "Order"
  ADD COLUMN "payment_method" "CheckoutPaymentMethod" NOT NULL DEFAULT 'UPI',
  ADD COLUMN "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
