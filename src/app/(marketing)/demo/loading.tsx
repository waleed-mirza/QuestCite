export default function DemoLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14" role="status" aria-live="polite">
      <div className="grid animate-pulse gap-6">
        <div className="h-14 rounded-xl bg-muted" />
        <div className="h-20 rounded-2xl bg-muted" />
        <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
          <div className="h-48 rounded-xl bg-muted" />
          <div className="h-[32rem] rounded-xl bg-muted" />
        </div>
      </div>
      <span className="sr-only">Loading the Northstar Cloud demo.</span>
    </div>
  );
}
