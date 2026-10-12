import type { ReactElement } from "react";

export default function TrustRequestLoading(): ReactElement {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-10" aria-busy="true">
      <h1 className="text-2xl font-semibold tracking-tight">Loading access request</h1>
      <p className="text-muted-foreground text-sm" role="status">
        Loading request details…
      </p>
    </main>
  );
}
