"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  Download,
  FileCheck2,
  FileSpreadsheet,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Upload,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEMO_DISABLED_OPERATIONS,
  DEMO_DISCLAIMER,
  DEMO_DOCUMENTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_QUESTIONS,
  DEMO_RUN_STEPS,
  demoActionAvailability,
  summarizeDemoQuestions,
  type DemoQuestion,
} from "@/features/demo/data";

type DemoView = "overview" | "knowledge" | "questionnaire" | "review";
type RunState = "idle" | "running" | "complete";

const VIEW_ITEMS: readonly { id: DemoView; label: string; icon: typeof BookOpen }[] = [
  { id: "overview", label: "Overview", icon: ShieldCheck },
  { id: "knowledge", label: "Knowledge base", icon: BookOpen },
  { id: "questionnaire", label: "Questionnaire", icon: FileSpreadsheet },
  { id: "review", label: "Review & export", icon: FileCheck2 },
] as const;

const OPERATION_ICONS: Record<(typeof DEMO_DISABLED_OPERATIONS)[number]["action"], typeof Upload> = {
  upload: Upload,
  invite: UserPlus,
  checkout: WalletCards,
  delete_workspace: XCircle,
};

const STATUS_LABELS: Record<DemoQuestion["disposition"], string> = {
  answered: "AI drafted",
  needs_review: "Needs review",
  insufficient_evidence: "Insufficient evidence",
};

const STATUS_CLASSES: Record<DemoQuestion["disposition"], string> = {
  answered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  needs_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  insufficient_evidence: "bg-muted text-neutral-700 dark:text-neutral-300",
};

const stats = summarizeDemoQuestions();

export function DemoWorkspace() {
  const [view, setView] = useState<DemoView>("overview");
  const [runState, setRunState] = useState<RunState>("idle");
  const [runStep, setRunStep] = useState(-1);

  useEffect(() => {
    if (runState !== "running") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const nextStep = runStep + 1;
      if (nextStep >= DEMO_RUN_STEPS.length) {
        setRunState("complete");
        return;
      }
      setRunStep(nextStep);
    }, 650);

    return () => window.clearTimeout(timer);
  }, [runState, runStep]);

  const startReplay = () => {
    setRunStep(-1);
    setRunState("running");
    setView("questionnaire");
  };

  return (
    <div className="grid gap-6">
      <div className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm" role="note">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>
          <strong>Sample workspace.</strong> Northstar Cloud is fictional demo data. {DEMO_DISCLAIMER}
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
            <ShieldCheck aria-hidden="true" className="size-6" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Read-only product tour</p>
            <h1 className="text-xl font-semibold tracking-tight">Northstar Cloud</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button render={<Link href="/trust/northstar-cloud" />} variant="outline" size="sm">
            View Trust Center <ArrowRight aria-hidden="true" />
          </Button>
          <Button render={<Link href="/login" />} size="sm">
            Build your workspace
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Demo workspace navigation" className="h-fit rounded-xl border bg-card p-2">
          <div className="grid gap-1">
            {VIEW_ITEMS.map((item) => {
              const selected = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setView(item.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon aria-hidden="true" className="size-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="border-border/60 mt-3 border-t px-3 pt-3">
            <p className="text-muted-foreground text-xs leading-relaxed">
              The demo is provider-free by default. Real uploads, billing, email, and AI are intentionally blocked here.
            </p>
          </div>
        </nav>

        <div className="min-w-0">
          {view === "overview" ? <OverviewPanel onReplay={startReplay} /> : null}
          {view === "knowledge" ? <KnowledgePanel /> : null}
          {view === "questionnaire" ? (
            <QuestionnairePanel runState={runState} runStep={runStep} onReplay={startReplay} />
          ) : null}
          {view === "review" ? <ReviewPanel /> : null}
        </div>
      </div>

      <DisabledOperations />
    </div>
  );
}

function OverviewPanel({ onReplay }: { onReplay: () => void }) {
  return (
    <div className="grid gap-6">
      <div>
        <p className="text-primary text-sm font-medium">A questionnaire workflow in one screen</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">From evidence to defensible answers</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
          Explore the fictional Northstar Cloud workspace. The answer run below replays stored results locally, so this signed-out tour never sends data to OpenAI or writes to the database.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Knowledge documents" value={DEMO_DOCUMENTS.length} detail="approved evidence sources" icon={BookOpen} />
        <StatCard label="Questionnaire" value={stats.totalQuestions} detail="sample questions" icon={FileSpreadsheet} />
        <StatCard label="Grounded drafts" value={stats.groundedDrafts} detail="with source citations" icon={Sparkles} />
        <StatCard label="Review flags" value={stats.needsReview + stats.insufficientEvidence} detail="human decisions remain" icon={CircleAlert} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>See the safe AI replay</CardTitle>
          <CardDescription>Four local stages, no provider call, no account required.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <ol className="grid gap-2 text-sm sm:grid-cols-4 sm:gap-4">
            {DEMO_RUN_STEPS.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <Button type="button" onClick={onReplay} className="shrink-0">
            <Play aria-hidden="true" /> Replay run
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <JourneyCard number="01" title="Import" body="Map the prospect's workbook while preserving the original structure." />
        <JourneyCard number="02" title="Draft" body="Use approved evidence and keep the exact citation beside each draft." />
        <JourneyCard number="03" title="Review & export" body="Keep a human approval gate before returning the completed workbook." />
      </div>
    </div>
  );
}

function KnowledgePanel() {
  return (
    <div className="grid gap-6">
      <PanelHeading eyebrow="Approved evidence" title="Knowledge base" description="Seven fictional policy documents and ten approved Q&A entries power the stored demo results." />
      <div className="grid gap-3 sm:grid-cols-2">
        {DEMO_DOCUMENTS.map((document) => (
          <Card key={document.key} size="sm">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="bg-blue-500/10 text-blue-700 dark:text-blue-400 flex size-9 items-center justify-center rounded-lg">
                  <BookOpen aria-hidden="true" className="size-4" />
                </div>
                <span className="text-muted-foreground text-xs">Ready</span>
              </div>
              <CardTitle className="mt-2 text-sm">{document.title}</CardTitle>
              <CardDescription>{document.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Approved Q&A</CardTitle>
          <CardDescription>Preferred short-form evidence used by retrieval.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border grid divide-y">
            {DEMO_KNOWLEDGE_ENTRIES.map((entry) => (
              <li key={entry.key} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium">{entry.question}</p>
                <p className="text-muted-foreground text-sm">{entry.answer}</p>
                <p className="text-muted-foreground text-xs">{entry.category} · approved</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function QuestionnairePanel({ runState, runStep, onReplay }: { runState: RunState; runStep: number; onReplay: () => void }) {
  const [query, setQuery] = useState("");
  const filteredQuestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery === "") {
      return DEMO_QUESTIONS.slice(0, 10);
    }
    return DEMO_QUESTIONS.filter((question) => `${question.question} ${question.category}`.toLowerCase().includes(normalizedQuery)).slice(0, 10);
  }, [query]);

  return (
    <div className="grid gap-6">
      <PanelHeading eyebrow="Stored run replay" title="Security Assessment" description="A 40-question fixture with grounded drafts, explicit review flags, and a deliberate abstention path." />
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Generate answers</CardTitle>
              <CardDescription>
                {runState === "idle" ? "Replay the pre-generated run to see the progress states." : runState === "complete" ? "Replay complete — every result is still a local fixture." : "Working through the stored replay…"}
              </CardDescription>
            </div>
            <Button type="button" onClick={onReplay} disabled={runState === "running"}>
              <Play aria-hidden="true" /> {runState === "running" ? "Running…" : "Generate answers"}
            </Button>
          </div>
          <div aria-live="polite" className="grid gap-2">
            {DEMO_RUN_STEPS.map((step, index) => {
              const complete = runState === "complete" || index < runStep;
              const active = runState === "running" && index === runStep;
              return (
                <div key={step} className="flex items-center gap-2 text-sm">
                  <span className={`flex size-6 items-center justify-center rounded-full ${complete ? "bg-emerald-600 text-white" : active ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground"}`}>
                    {complete ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
                  </span>
                  <span className={active ? "font-medium" : "text-muted-foreground"}>{step}</span>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <LockKeyhole aria-hidden="true" className="size-3.5" /> AI is off for the public demo; no question or answer leaves this page.
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Grounded" value={stats.groundedDrafts} detail="answered with citations" icon={Check} />
        <StatCard label="Needs review" value={stats.needsReview} detail="partial or uncertain" icon={CircleAlert} />
        <StatCard label="Abstained" value={stats.insufficientEvidence} detail="no evidence found" icon={XCircle} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle>Question preview</CardTitle>
              <CardDescription>Editing here is simulated browser state and resets on refresh.</CardDescription>
            </div>
            <label className="grid gap-1 text-xs font-medium sm:w-64">
              Filter questions
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search security, access…"
                className="border-input bg-background h-9 rounded-md border px-3 text-sm font-normal"
              />
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {filteredQuestions.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">No sample questions match that filter.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <caption className="sr-only">Sample questionnaire questions and stored result statuses</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th scope="col" className="px-3 py-2 font-medium">Question</th>
                    <th scope="col" className="w-36 px-3 py-2 font-medium">Status</th>
                    <th scope="col" className="w-36 px-3 py-2 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuestions.map((question) => (
                    <DemoQuestionRow key={question.key} question={question} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted-foreground mt-3 text-xs">Showing {filteredQuestions.length} of {stats.totalQuestions} sample questions.</p>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Completed sample workbook</p>
          <p className="text-muted-foreground text-sm">Download the fictional output with answer and evidence columns.</p>
        </div>
        <Button render={<a href="/demo/northstar-cloud-security-assessment.xlsx" download />} variant="outline">
          <Download aria-hidden="true" /> Download workbook
        </Button>
      </div>
    </div>
  );
}

function DemoQuestionRow({ question }: { question: DemoQuestion }) {
  const [text, setText] = useState(question.answer);
  const availability = demoActionAvailability("simulate_edit");

  return (
    <>
      <tr className="border-b align-top last:border-0">
        <td className="px-3 py-3">
          <p>{question.question}</p>
          <p className="text-muted-foreground mt-1 text-xs">{question.category}</p>
        </td>
        <td className="px-3 py-3">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[question.disposition]}`}>
            {STATUS_LABELS[question.disposition]}
          </span>
        </td>
        <td className="px-3 py-3 text-xs">
          {question.sourceKey === null ? <span className="text-muted-foreground">None — abstained</span> : <span className="text-emerald-700 dark:text-emerald-400">{question.evidenceStrength} · cited</span>}
        </td>
      </tr>
      <tr className="border-b bg-muted/20 last:border-0">
        <td colSpan={3} className="px-3 py-3">
          <label className="grid gap-1 text-xs font-medium">
            Simulated answer
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-describedby={`demo-edit-note-${question.key}`}
              rows={2}
              className="border-input bg-background rounded-md border px-3 py-2 text-sm font-normal"
            />
          </label>
          <p id={`demo-edit-note-${question.key}`} className="text-muted-foreground mt-1 text-xs">{availability.message} Refresh to reset.</p>
          {question.reviewNote !== null ? <p className="mt-1 text-amber-700 dark:text-amber-400 text-xs">Review note: {question.reviewNote}</p> : null}
        </td>
      </tr>
    </>
  );
}

function ReviewPanel() {
  return (
    <div className="grid gap-6">
      <PanelHeading eyebrow="Human gate" title="Review & export" description="The demo makes uncertainty visible and keeps approval separate from AI drafting." />
      <Card>
        <CardHeader>
          <CardTitle>Review queue</CardTitle>
          <CardDescription>These examples remain intentionally unresolved until a human makes the decision.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {DEMO_QUESTIONS.filter((question) => question.disposition !== "answered").map((question) => (
            <div key={question.key} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium">{question.question}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[question.disposition]}`}>{STATUS_LABELS[question.disposition]}</span>
              </div>
              <p className="text-muted-foreground mt-2 text-sm">{question.answer === "" ? "No approved evidence supports a safe answer. The correct next step is manual research." : question.answer}</p>
              {question.reviewNote !== null ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{question.reviewNote}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Export guard</CardTitle>
          <CardDescription>The real template will block export until every question has an explicit decision.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <LockKeyhole aria-hidden="true" className="text-muted-foreground size-4" />
            <span>{stats.needsReview + stats.insufficientEvidence} decisions still needed</span>
          </div>
          <Button render={<a href="/demo/northstar-cloud-security-assessment.xlsx" download />} variant="outline">
            <Download aria-hidden="true" /> Download sample output
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DisabledOperations() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions disabled in the public demo</CardTitle>
        <CardDescription>Nothing here can mutate the demo tenant, send email, charge a card, or invoke a live provider.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_DISABLED_OPERATIONS.map((operation) => {
          const Icon = OPERATION_ICONS[operation.action];
          const availability = demoActionAvailability(operation.action);
          return (
            <div key={operation.action} className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon aria-hidden="true" className="text-muted-foreground size-4" />
                {operation.label}
              </div>
              <Button type="button" disabled title={availability.message} variant="outline" size="sm">
                Unavailable in demo
              </Button>
              <p className="text-muted-foreground text-xs">{availability.message}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PanelHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <p className="text-primary text-sm font-medium">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof BookOpen }) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardDescription>{label}</CardDescription>
          <Icon aria-hidden="true" className="text-muted-foreground size-4" />
        </div>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </CardHeader>
    </Card>
  );
}

function JourneyCard({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-primary text-xs font-semibold tracking-wide">{number}</p>
      <h3 className="mt-2 font-medium">{title}</h3>
      <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
