"use client";

import { useState } from "react";
import ServiceTile from "@/components/driver/service/ServiceTile";
import JobRequestCard from "@/components/driver/service/JobRequestCard";
import JobStepBar from "@/components/driver/service/JobStepBar";
import JobEndedPanel from "@/components/driver/service/JobEndedPanel";

const TILES = [
    { service: "RIDE", state: { status: "APPROVED", eligible: true, enabled: true } },
    { service: "PARCEL", state: { status: "APPROVED", eligible: true, enabled: false } },
    { service: "BUY_DELIVER", state: { status: "UNDER_REVIEW" } },
    { service: "RENTAL", state: { status: "NOT_APPLIED" } },
];

export default function ServicesDemo() {
    const [tiles, setTiles] = useState(TILES);
    const [fee, setFee] = useState("");
    const [parcelFare, setParcelFare] = useState("1200");

    const toggle = (service, on) =>
        setTiles((prev) => prev.map((t) => (t.service === service ? { ...t, state: { ...t.state, enabled: on } } : t)));

    return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 bg-pd-bg p-4 text-pd-text">
            <h1 className="text-2xl font-black">My services</h1>
            <section aria-label="Services" className="flex flex-col gap-3">
                {tiles.map((t) => (
                    <ServiceTile key={t.service} service={t.service} state={t.state}
                        badge={t.service === "PARCEL" ? 2 : 0}
                        onOpen={() => {}} onToggle={(on) => toggle(t.service, on)} />
                ))}
            </section>

            <JobRequestCard
                service="PARCEL" heading="New parcel" subject="Documents envelope" subjectNote="Handle with care"
                amountLabel="You earn" amountText="PKR 1,200" fromText="Gulberg III, Lahore" toText="DHA Phase 5, Lahore"
                baseFare={1200} fare={parcelFare} onFareChange={setParcelFare}
                acceptLabel="Accept parcel" onAccept={() => {}} onDecline={() => {}}
            />

            <JobRequestCard
                service="BUY_DELIVER" heading="Buy & Deliver" subject={"2 kg flour\n1 bottle cooking oil"}
                amountLabel="Shopping budget up to" amountText="PKR 3,500"
                fromLabel="Buy from" fromText="Any shop near you" toLabel="Deliver to" toText="Model Town, Lahore"
                requireFee fare={fee} onFareChange={setFee} acceptLabel="Send my offer"
                onAccept={() => {}} onDecline={() => {}}
            />

            <JobRequestCard
                service="RENTAL" heading="Rental booking" subject="Toyota Corolla (2021)"
                amountLabel="Rental charges" amountText="PKR 18,000" fromLabel="From" fromText="12 Jun, 9:00 am"
                toLabel="Until" toText="14 Jun, 9:00 am" acceptLabel="Accept booking" onAccept={() => {}} onDecline={() => {}}
            />

            <JobStepBar service="PARCEL" status="PICKED_UP" />

            <JobEndedPanel completed title="Parcel delivered" message="Well done. Your earnings were added."
                amountLabel="You earned" amountText="PKR 1,200" backHref="/preview/driver-services" backLabel="Back to jobs" />
        </main>
    );
}
