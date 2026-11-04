"use client";

import { Flag, Power, BellRing } from "lucide-react";
import { JOURNEYS } from "@/components/driver/service/serviceJourneys";

/** The same three plain answers for every service. */
export default function HowItWorks({ service, className = "" }) {
    const journey = JOURNEYS[service];
    const rows = [
        { Icon: Power, title: "1. Turn it on or off", body: journey.turnOn },
        { Icon: BellRing, title: "2. Get a job", body: journey.receive },
        { Icon: Flag, title: "3. Finish the job", body: journey.finish },
    ];
    return (
        <section aria-label={`How ${journey.label} works`} className={`flex flex-col gap-3 ${className}`}>
            <h2 className="text-lg font-black">How {journey.label} works</h2>
            <ol className="flex flex-col gap-3">
                {rows.map(({ Icon, title, body }) => (
                    <li key={title} className="flex items-start gap-3 rounded-2xl bg-pd-surface-2 p-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-pd-accent-soft text-pd-accent-text" aria-hidden>
                            <Icon size={20} />
                        </span>
                        <div className="min-w-0">
                            <p className="text-base font-extrabold">{title}</p>
                            <p className="text-base leading-snug text-pd-text-2">{body}</p>
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
}
