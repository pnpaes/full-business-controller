import { Skeleton, spacing } from "@aquarela/ui";

/** Authenticated-area loading state: a lightweight token-driven skeleton,
 * shaped like the content columns the screens use. */
export default function AppLoading() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[3],
        width: "100%",
        maxWidth: 1120,
        margin: "0 auto",
        padding: `${spacing[8]}px ${spacing[4]}px`,
      }}
      role="status"
      aria-busy="true"
      aria-label="Loading page content"
    >
      <Skeleton width="30%" height={24} />
      <Skeleton height={14} />
      <Skeleton height={14} />
      <Skeleton width="60%" height={14} />
    </main>
  );
}
