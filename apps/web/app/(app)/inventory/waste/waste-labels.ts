/**
 * DEC-018 waste-stage labels, worded neutrally and blame-free, with Norwegian
 * and English text. The codes mirror the `WASTE_STAGE` vocabulary in
 * `@aquarela/persistence`; this module deliberately does not import it so it can
 * be used from server components without pulling the persistence bundle in.
 *
 * The wording is provisional until the owner/product sign-off DEC-018 calls for
 * (recorded, not resolved).
 */
const STAGE_LABELS: Record<string, { readonly en: string; readonly no: string }> = {
  receiving: { en: "Receiving", no: "Varemottak" },
  storage_expiry: { en: "Storage / expiry", no: "Lagring / utløp" },
  preparation: { en: "Preparation", no: "Tilberedning" },
  production: { en: "Production", no: "Produksjon" },
  display: { en: "Display", no: "Utsalg" },
  unsold_finished_goods: { en: "Unsold finished goods", no: "Usolgte ferdigvarer" },
  customer_return: { en: "Customer return", no: "Kunderetur" },
  count_discovered: { en: "Found during count", no: "Funnet ved telling" },
  other: { en: "Other", no: "Annet" },
};

/** "English / Norsk" for a known stage, or the humanised code as a fallback. */
export function wasteStageLabel(stage: string): string {
  const entry = STAGE_LABELS[stage];
  if (entry === undefined) {
    const spaced = stage.replace(/_/g, " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  return `${entry.en} / ${entry.no}`;
}

export interface WasteStageOption {
  readonly value: string;
  readonly label: string;
}

/** The nine DEC-018 stages as select options, in vocabulary order. */
export function wasteStageOptions(stages: readonly string[]): readonly WasteStageOption[] {
  return stages.map((stage) => ({ value: stage, label: wasteStageLabel(stage) }));
}
