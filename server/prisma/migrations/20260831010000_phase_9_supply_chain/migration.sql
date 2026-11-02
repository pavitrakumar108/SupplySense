-- Link supplier portal accounts to supplier records.
ALTER TABLE "Supplier" ADD COLUMN "user_id" UUID;

CREATE UNIQUE INDEX "Supplier_user_id_key" ON "Supplier"("user_id");

ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shipment quantities are itemised so partial shipments and outstanding quantities are auditable.
CREATE TABLE "ShipmentItem" (
  "id" UUID NOT NULL,
  "shipment_id" UUID NOT NULL,
  "purchase_order_item_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "quantity_shipped" INTEGER NOT NULL,
  CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShipmentItem_shipment_id_idx" ON "ShipmentItem"("shipment_id");
CREATE INDEX "ShipmentItem_purchase_order_item_id_idx" ON "ShipmentItem"("purchase_order_item_id");

ALTER TABLE "ShipmentItem"
  ADD CONSTRAINT "ShipmentItem_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ShipmentItem_purchase_order_item_id_fkey"
  FOREIGN KEY ("purchase_order_item_id") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ShipmentItem_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ShipmentItem_quantity_shipped_positive"
  CHECK ("quantity_shipped" > 0);
