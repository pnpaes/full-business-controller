"use client";

import { Button, Modal } from "@aquarela/ui";
import { useState } from "react";

import { RegisterProductForm } from "./register-product-form";

export interface NewProductModalProps {
  readonly productKinds: readonly string[];
}

/**
 * The single primary action of the products register: a "New product" button
 * that opens the product create form in a `Modal` (`docs/ux/README.md`,
 * "Creation and hierarchy"). The register body stays a list — no form renders
 * on the page.
 */
export function NewProductModal({ productKinds }: NewProductModalProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New product</Button>
      <Modal title="New product" open={open} onClose={() => setOpen(false)}>
        <RegisterProductForm productKinds={productKinds} onSuccess={() => setOpen(false)} />
      </Modal>
    </>
  );
}
