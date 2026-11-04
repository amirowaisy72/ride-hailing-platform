import { BRAND } from "@/config/brand";

export default function SafarLoader({ label = "Getting your ride ready" }) {
  return (
    <main
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-pd-bg px-6 text-pd-text"
      role="status"
      aria-live="polite"
    >
      <div className="pd-loader-glow pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full" />

      <div className="relative flex flex-col items-center gap-8">
        <div className="relative flex h-36 w-36 items-center justify-center">
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 144 144"
            aria-hidden="true"
          >
            <circle
              cx="72"
              cy="72"
              r="66"
              fill="none"
              stroke="var(--pd-line-strong)"
              strokeWidth="1.5"
              strokeDasharray="3 7"
              strokeLinecap="round"
            />
          </svg>

          <div className="pd-loader-orbit absolute inset-0" aria-hidden="true">
            <svg className="h-full w-full" viewBox="0 0 144 144">
              <circle
                cx="72"
                cy="72"
                r="66"
                fill="none"
                stroke="var(--pd-accent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="70 345"
              />
            </svg>
            <span className="absolute left-1/2 top-[3px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-[3px] border-pd-bg bg-pd-accent-text shadow-pd" />
          </div>

          <div className="pd-loader-breathe relative flex h-20 w-20 items-center justify-center rounded-3xl bg-pd-surface shadow-pd-lg ring-1 ring-pd-line">
            <img
              src="/safar-icon.png"
              alt=""
              className="h-14 w-14 rounded-2xl object-cover"
            />
          </div>
        </div>

        <div className="pd-rise flex flex-col items-center gap-1.5 text-center">
          <p className="text-2xl font-extrabold tracking-tight">{BRAND.name}</p>
          <p className="text-sm text-pd-muted">Easy rides. Better journeys.</p>
        </div>

        <div
          className="pd-rise flex w-44 flex-col items-center gap-3"
          style={{ animationDelay: "120ms" }}
        >
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--pd-line-strong)" }}
          >
            <div className="pd-loader-bar h-full w-1/3 rounded-full bg-pd-accent" />
          </div>
          <p className="text-xs font-semibold tracking-wide text-pd-text-2">
            {label}
          </p>
        </div>
      </div>
    </main>
  );
}
