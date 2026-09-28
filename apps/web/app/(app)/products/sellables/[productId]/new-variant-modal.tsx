"use client";

import { Button, Modal } from "@aquarela/ui";
import { useState } from "react";

import { RegisterVariantForm } from "./register-variant-form";
import type { ItemOption } from "./register-variant-form";

export interface NewVariantModalProps {
  readonly productId: string;
  readonly items: readonly ItemOption[];
}

/**
 * The child-create action of the product view: a "New variant" button that
 * opens the variant create form in a `Modal` (`docs/ux/README.md`, "Creation
 * and hierarchy"). The parent product is bound, so no product selector is
 * offered; variants are never created from the products list.
 */
export function NewVariantModal({ productId, items }: NewVariantModalProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New variant</Button>
      <Modal title="New variant" open={open} onClose={() => setOpen(false)}>
        <RegisterVariantForm productId={productId} items={items} onSuccess={() => setOpen(false)} />
      </Modal>
    </>
  );
}
