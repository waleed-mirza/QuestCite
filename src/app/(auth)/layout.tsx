import { ShieldCheck } from "lucide-react";

import { appConfig } from "@/config/app";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      className="bg-muted/30 flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-12"
    >
      <p className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck aria-hidden="true" className="text-primary size-5" />
        {appConfig.name}
      </p>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
