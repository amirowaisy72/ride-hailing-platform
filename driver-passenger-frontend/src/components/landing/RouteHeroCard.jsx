import { Car, MapPin } from "lucide-react";

const streetGrid = {
  backgroundImage:
    "linear-gradient(var(--pd-line-strong) 1px, transparent 1px), linear-gradient(90deg, var(--pd-line-strong) 1px, transparent 1px)",
  backgroundSize: "32px 32px",
  backgroundPosition: "-1px -1px",
};

export default function RouteHeroCard() {
  return (
    <div
      className="pd-rise relative isolate w-full overflow-hidden rounded-[28px] border border-pd-line bg-pd-accent-soft shadow-pd"
      style={{ height: "clamp(168px, 34dvh, 290px)" }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 opacity-60" style={streetGrid} />

      <div className="absolute -left-[15%] top-[44%] h-7 w-[130%] -rotate-[14deg] bg-pd-surface/90" />
      <div className="absolute left-[58%] -top-[20%] h-[140%] w-6 rotate-[24deg] bg-pd-surface/90" />
      <div className="absolute left-[12%] -top-[10%] h-[120%] w-3 -rotate-[8deg] bg-pd-surface/70" />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path
          d="M 22 28 C 34 62, 58 30, 80 42"
          fill="none"
          stroke="var(--pd-accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="0.5 7"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="absolute left-[22%] top-[28%] -translate-x-1/2 -translate-y-1/2">
        <span className="pd-live-dot absolute inset-0 rounded-full" />
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full border border-pd-line bg-pd-surface text-pd-accent shadow-pd dark:text-pd-accent-text">
          <MapPin className="h-5 w-5" strokeWidth={2.25} />
        </span>
      </div>

      <div className="absolute left-[80%] top-[42%] -translate-x-1/2 -translate-y-1/2">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pd-accent text-pd-accent-ink shadow-pd-lg">
          <Car className="h-6 w-6" strokeWidth={2.25} />
        </span>
      </div>

      <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl border border-pd-line bg-pd-elevated px-4 py-3 shadow-pd backdrop-blur-md">
        <span className="h-9 w-1 shrink-0 rounded-full bg-pd-accent" />
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] font-bold tracking-[0.14em] text-pd-accent dark:text-pd-accent-text">
            YOUR CITY, YOUR WAY
          </span>
          <span className="text-sm font-medium text-pd-text-2">
            Easy rides. Better journeys.
          </span>
        </div>
      </div>
    </div>
  );
}
