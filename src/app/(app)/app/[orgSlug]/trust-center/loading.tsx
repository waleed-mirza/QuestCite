import type { ReactElement } from "react";

/** Trust Center editor loading state. */
export default function TrustCenterEditorLoading(): ReactElement {
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-4" aria-busy="true">
      <h1 className="text-2xl font-semibold tracking-tight">Loading Trust Center</h1>
      <p className="text-muted-foreground text-sm" role="status">
        Loading editor settings…
      </p>
    </main>
  );
}
