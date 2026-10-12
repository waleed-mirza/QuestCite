import type { ReactElement } from "react";

export default function TrustAccessLoading(): ReactElement {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-10" aria-busy="true">
      <h1 className="text-2xl font-semibold tracking-tight">Loading secure access</h1>
      <p className="text-muted-foreground text-sm" role="status">
        Validating your access link…
      </p>
    </main>
  );
}
