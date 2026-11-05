"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, CarFront, CheckCircle2, CircleAlert, Hourglass, Plus, Power } from "lucide-react";
import { vehicleNames } from "@/components/driver/DriverRequestCard";

/* Guided home for a driver who is not online yet. Exactly one step is
   shown at a time and every step has at most one big button:
     choose  - pick an approved vehicle
     pending - vehicle is with admin, nothing to do
     offline - go online
   Everything it does is passed in; it makes no API calls itself. */

const STEP_LABEL = {
    choose: "Step 1 of 2",
    pending: "Step 1 of 2",
    offline: "Step 2 of 2",
};

function vehicleLine(vehicle) {
    if (!vehicle) return "";
    return `${vehicleNames[vehicle.vehicleType] || vehicle.vehicleType} · ${vehicle.registrationNumber}`;
}

function StepHeader({ step, title }) {
    return (
        <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-pd-accent-text">{STEP_LABEL[step]}</p>
            <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight text-pd-text text-balance">{title}</h1>
        </div>
    );
}

function BigButton({ icon: Icon, children, onClick, href, disabled }) {
    const className =
        "flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-pd-accent px-5 text-lg font-black text-pd-accent-ink shadow-lg shadow-black/10 transition-transform active:scale-[0.98] disabled:opacity-50";
    if (href) {
        return (
            <Link href={href} className={className}>
                {Icon && <Icon size={24} aria-hidden="true" />}
                {children}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} disabled={disabled} className={className}>
            {Icon && <Icon size={24} aria-hidden="true" />}
            {children}
        </button>
    );
}

export default function GuidedHomeCard({
    step,
    loading,
    vehicles,
    selectedVehicle,
    savedVehicle,
    chosenVehicle,
    choosing,
    busy,
    onlineBlock,
    blockedLine,
    onOpenChoose,
    onCloseChoose,
    onSelectVehicle,
    onSaveVehicle,
    onGoOnline,
    onHeight,
}) {
    const ref = useRef(null);

    useEffect(() => {
        const node = ref.current;
        if (!node || !onHeight || typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(() => onHeight(node.offsetHeight));
        observer.observe(node);
        onHeight(node.offsetHeight);
        return () => observer.disconnect();
    }, [onHeight]);

    const shell = "absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-xl px-3 pb-3";
    const card = "rounded-3xl border border-pd-line bg-pd-surface p-5 text-pd-text shadow-[0_-8px_32px_rgba(17,17,17,0.14)]";

    if (loading) {
        return (
            <div className={shell}>
                <div ref={ref} className={card} aria-busy="true">
                    <div className="h-4 w-24 animate-pulse rounded-full bg-pd-surface-2" />
                    <div className="mt-3 h-8 w-3/4 animate-pulse rounded-xl bg-pd-surface-2" />
                    <div className="mt-5 h-16 animate-pulse rounded-2xl bg-pd-surface-2" />
                </div>
            </div>
        );
    }

    /* Vehicle picker: one list, one button */
    if (choosing && vehicles.length > 0) {
        const unchanged = selectedVehicle === savedVehicle;
        return (
            <div className={shell}>
                <section ref={ref} className={card} aria-label="Choose your vehicle">
                    <div className="flex items-start justify-between gap-3">
                        <StepHeader step="choose" title="Tap the vehicle you will drive" />
                        {chosenVehicle && (
                            <button type="button" onClick={onCloseChoose} aria-label="Go back"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pd-surface-2">
                                <ArrowLeft size={20} />
                            </button>
                        )}
                    </div>
                    <div className="mt-4 max-h-[34dvh] space-y-2 overflow-y-auto" role="radiogroup" aria-label="Approved vehicles">
                        {vehicles.map((vehicle) => {
                            const active = selectedVehicle === vehicle._id;
                            return (
                                <button key={vehicle._id} type="button" role="radio" aria-checked={active}
                                    onClick={() => onSelectVehicle(vehicle._id)}
                                    className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${active ? "border-pd-accent bg-pd-accent-soft" : "border-pd-line bg-pd-surface"}`}>
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pd-surface-2 text-pd-accent-text">
                                        <CarFront size={22} aria-hidden="true" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-base font-extrabold">{vehicleNames[vehicle.vehicleType] || vehicle.vehicleType}</span>
                                        <span className="block text-sm font-semibold text-pd-muted">{vehicle.registrationNumber}</span>
                                    </span>
                                    {active && <CheckCircle2 size={24} className="shrink-0 text-pd-accent-text" aria-hidden="true" />}
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-4">
                        <BigButton icon={CheckCircle2} onClick={unchanged ? onCloseChoose : onSaveVehicle}
                            disabled={busy || !selectedVehicle}>
                            {busy ? "Please wait…" : unchanged ? "Keep this vehicle" : "Use this vehicle"}
                        </BigButton>
                    </div>
                    <div className="mt-3 text-center">
                        <Link href="/driver/vehicles" className="inline-flex min-h-11 items-center font-extrabold text-pd-accent-text underline">
                            Add another vehicle
                        </Link>
                    </div>
                </section>
            </div>
        );
    }

    if (step === "choose") {
        const hasVehicles = vehicles.length > 0;
        return (
            <div className={shell}>
                <section ref={ref} className={card} aria-label="Step 1: choose your vehicle">
                    <StepHeader step="choose" title="Choose your vehicle" />
                    <p className="mt-2 text-base font-medium leading-relaxed text-pd-text-2">
                        {hasVehicles
                            ? "You need an approved vehicle before you can go online."
                            : "You have no approved vehicle yet. Add your vehicle so admin can check it. You need an approved vehicle before you can go online."}
                    </p>
                    <div className="mt-5">
                        {hasVehicles
                            ? <BigButton icon={CarFront} onClick={onOpenChoose}>Choose vehicle</BigButton>
                            : <BigButton icon={Plus} href="/driver/vehicles">Add vehicle</BigButton>}
                    </div>
                </section>
            </div>
        );
    }

    if (step === "pending") {
        return (
            <div className={shell}>
                <section ref={ref} className={card} aria-label="Vehicle waiting for approval">
                    <StepHeader step="pending" title="Waiting for admin" />
                    <div className="mt-3 flex items-start gap-3 rounded-2xl bg-pd-warning-soft p-4">
                        <Hourglass size={26} className="mt-0.5 shrink-0 text-pd-warning" aria-hidden="true" />
                        <p className="text-base font-semibold leading-relaxed text-pd-text">
                            Your vehicle is with admin for checking. You will be able to go online as soon as it is approved.
                        </p>
                    </div>
                    <div className="mt-3 text-center">
                        <Link href="/driver/vehicles" className="inline-flex min-h-11 items-center font-extrabold text-pd-accent-text underline">
                            Add another vehicle
                        </Link>
                    </div>
                </section>
            </div>
        );
    }

    /* offline: the one button is Go online */
    return (
        <div className={shell}>
            <section ref={ref} className={card} aria-label="Step 2: go online">
                <StepHeader step="offline" title="You are offline" />
                <p className="mt-2 text-base font-medium leading-relaxed text-pd-text-2">
                    Go online to start receiving ride requests.
                </p>
                {chosenVehicle && (
                    <p className="mt-3 flex items-center gap-2 text-sm font-bold text-pd-muted">
                        <CarFront size={16} aria-hidden="true" />
                        <span className="min-w-0 truncate">{vehicleLine(chosenVehicle)}</span>
                        {vehicles.length > 1 && (
                            <button type="button" onClick={onOpenChoose} className="shrink-0 py-2 font-extrabold text-pd-accent-text underline">
                                Change
                            </button>
                        )}
                        <Link href="/driver/vehicles" className="shrink-0 py-2 font-extrabold text-pd-accent-text underline">
                            Add vehicle
                        </Link>
                    </p>
                )}
                {onlineBlock && (
                    <div role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-pd-danger-soft p-3">
                        <CircleAlert size={18} className="mt-0.5 shrink-0 text-pd-danger" aria-hidden="true" />
                        <div className="min-w-0 flex-1 text-sm font-semibold">
                            <p className="font-extrabold">{onlineBlock.message}</p>
                            {blockedLine}
                            <Link href="/driver/services" className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-pd-accent px-4 text-sm font-extrabold text-pd-accent-ink">
                                Fix in Services
                            </Link>
                        </div>
                    </div>
                )}
                <div className="mt-5">
                    <BigButton icon={Power} onClick={onGoOnline} disabled={busy}>
                        {busy ? "Please wait…" : "Go online"}
                    </BigButton>
                </div>
            </section>
        </div>
    );
}
