import type { Metadata } from "next";

import { DemoWorkspace } from "@/features/demo/components/demo-workspace";

export const metadata: Metadata = {
  title: "Northstar Cloud demo",
  description:
    "Explore a fictional QuestCite security questionnaire workflow with safe, provider-free answer replay.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Northstar Cloud demo | QuestCite",
    description: "A read-only product tour using fictional security evidence and stored answer results.",
  },
};

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <DemoWorkspace />
    </div>
  );
}
