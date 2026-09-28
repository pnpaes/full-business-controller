"use client";

import { Button, Modal } from "@aquarela/ui";
import { useState } from "react";

import { RegisterItemForm } from "./register-item-form";

export interface NewItemModalProps {
  readonly itemTypes: readonly string[];
  readonly inventoryPolicies: readonly string[];
}

/**
 * The Items register's single primary action (`docs/ux/README.md` "Creation and
 * hierarchy"): a compact "New item" button that opens the register form in a
 * modal. No inline or collapsed create form renders on the page.
 */
export function NewItemModal({ itemTypes, inventoryPolicies }: NewItemModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>New item</Button>
      <Modal title="New item" open={open} onClose={() => setOpen(false)}>
        <RegisterItemForm
          itemTypes={itemTypes}
          inventoryPolicies={inventoryPolicies}
          onSuccess={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
