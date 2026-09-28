"use client";

/**
 * Interactive Wave 0 demos for the styleguide (`docs/ux/README.md`): the
 * client-only parts — `FormModal` and `SuccessToast` — that a server component
 * cannot drive on its own. The page stays a server component; this file is its
 * one client leaf. Nothing here is production logic.
 */
import { Button, FormModal, SuccessToast, TextField } from "@aquarela/ui";
import { useState } from "react";

/** The one create/edit modal shape: trigger button + `FormModal`. */
export function FormModalDemo() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setOpen(false);
    }, 500);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>New supplier</Button>
      <FormModal
        title="New supplier"
        description="Register a supplier and the email its purchase orders go to."
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        busy={busy}
        submitLabel="Create supplier"
      >
        <TextField name="demo-supplier" label="Supplier name" required />
        <TextField
          name="demo-supplier-email"
          label="Order email"
          type="email"
          help="Purchase orders are sent here."
        />
      </FormModal>
    </>
  );
}

/** The transient post-mutation success pattern (vs the in-flow `Alert`). */
export function SuccessToastDemo() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Show success toast
      </Button>
      <SuccessToast
        open={open}
        onDismiss={() => setOpen(false)}
        duration={0}
        message="Supplier created."
      />
    </>
  );
}
