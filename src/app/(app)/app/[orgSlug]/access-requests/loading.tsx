import type { ReactElement } from "react";

/** Access request queue loading state. */
export default function AccessRequestsLoading(): ReactElement {
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-4" aria-busy="true">
      <h1 className="text-2xl font-semibold tracking-tight">Loading access requests</h1>
      <p className="text-muted-foreground text-sm" role="status">
        Loading the review queue…
      </p>
    </main>
  );
}
