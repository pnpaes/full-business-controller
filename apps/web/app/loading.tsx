import { Skeleton, color, spacing } from "@aquarela/ui";

const frame = {
  display: "flex",
  justifyContent: "center",
  padding: `${spacing[12]}px ${spacing[4]}px`,
  backgroundColor: color.background.page,
} as const;

/** Root loading state (covers unauthenticated routes). Token-driven skeleton
 * only; no session assumption. */
export default function RootLoading() {
  return (
    <main style={frame} role="status" aria-busy="true" aria-label="Loading page content">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing[3],
          width: "100%",
          maxWidth: 720,
        }}
      >
        <Skeleton width="40%" height={24} />
        <Skeleton height={14} />
        <Skeleton height={14} />
        <Skeleton width="70%" height={14} />
      </div>
    </main>
  );
}
