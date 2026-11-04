"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import ServiceTile from "@/components/driver/service/ServiceTile";
import ServiceSetupSteps from "@/components/driver/service/ServiceSetupSteps";
import {
    applyForService,
    getMyRentalPartner,
    getMyServices,
    updateServiceAvailability,
    updateServiceTransportMode,
} from "@/lib/driverServicesService";

export default function DriverServicesPage() {
    return (
        <AuthGuard role="DRIVER">
            <MyServicesScreen />
        </AuthGuard>
    );
}

function rentalTileStatus(partner) {
    const s = partner?.applicationStatus;
    if (s === "APPROVED") return { text: "Approved. Tap to manage your cars and bookings.", tone: "good", canSwitch: false };
    if (s === "PENDING" || s === "UNDER_REVIEW") return { text: "Safar is checking your application. Please wait.", tone: "wait", canSwitch: false };
    if (s === "REJECTED") return { text: "Not approved. Tap to fix and try again.", tone: "bad", canSwitch: false };
    if (s === "SUSPENDED") return { text: "Stopped by Safar. Tap to see why.", tone: "bad", canSwitch: false };
    return { text: "Not started. Tap to set up.", tone: "off", canSwitch: false };
}

/**
 * Setup state for one service. Saving uses the existing service APIs; only the
 * presentation (one step per screen) is new. Keyed so a server-confirmed change
 * re-initialises the local choices from fresh data.
 */
function ServiceFlow({ state, token, onChanged, onBack }) {
    const isBuyDeliver = state.service === "BUY_DELIVER";
    const [selectedMode, setSelectedMode] = useState(state.transportMode || "");
    const [policyChecked, setPolicyChecked] = useState(false);
    const [busy, setBusy] = useState("");
    const [notice, setNotice] = useState(null);
    const applied = state.applicationStatus !== "NOT_APPLIED";

    async function run(key, action) {
        if (busy) return;
        setBusy(key);
        try {
            await action();
            setNotice(null);
        } catch (error) {
            setNotice({ kind: "error", text: error.message });
        } finally {
            setBusy("");
        }
    }

    function apply() {
        if (isBuyDeliver && !selectedMode) {
            setNotice({ kind: "error", text: "Choose how you will travel first." });
            return;
        }
        run("apply", async () => {
            const data = await applyForService(
                state.service,
                isBuyDeliver
                    ? { transportMode: selectedMode, policyAcknowledged: policyChecked || state.policyAcknowledged }
                    : {},
                token
            );
            onChanged(data.service);
        });
    }

    function chooseMode(mode) {
        setSelectedMode(mode);
        if (!applied) return;
        run("mode", async () => {
            const data = await updateServiceTransportMode(state.service, mode, token);
            onChanged(data.service);
        });
    }

    function toggle(enabled) {
        run("toggle", async () => {
            await updateServiceAvailability(state.service, enabled, token);
            onChanged(null, true);
        });
    }

    return (
        <ServiceSetupSteps
            service={state.service}
            state={state}
            busy={busy}
            notice={notice}
            selectedMode={selectedMode}
            onModeChange={chooseMode}
            policyChecked={policyChecked}
            onPolicyChange={setPolicyChecked}
            onApply={apply}
            onToggle={toggle}
            onBack={onBack}
        />
    );
}

function MyServicesScreen() {
    const { token } = useAuth();
    const router = useRouter();
    const [services, setServices] = useState(null);
    const [rentalPartner, setRentalPartner] = useState(undefined);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState(null);
    const [toggleNotice, setToggleNotice] = useState(null);
    const [toggling, setToggling] = useState("");

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const data = await getMyServices(token);
            setServices(data.services || []);
            setError("");
        } catch (err) {
            setError(err.message);
        }
        try {
            const data = await getMyRentalPartner(token);
            setRentalPartner(data.rentalPartner || null);
        } catch {
            setRentalPartner(null);
        }
    }, [token]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await getMyServices(token);
                if (cancelled) return;
                setServices(data.services || []);
                setError("");
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
            try {
                const data = await getMyRentalPartner(token);
                if (!cancelled) setRentalPartner(data.rentalPartner || null);
            } catch {
                if (!cancelled) setRentalPartner(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    function onChanged(updated, refetch) {
        if (refetch || !updated) {
            void load();
            return;
        }
        setServices((previous) =>
            (previous || []).map((item) => (item.service === updated.service ? updated : item))
        );
    }

    async function quickToggle(state, enabled) {
        if (toggling) return;
        setToggling(state.service);
        try {
            await updateServiceAvailability(state.service, enabled, token);
            setToggleNotice(null);
            await load();
        } catch (err) {
            setToggleNotice({ kind: "error", text: err.message });
        } finally {
            setToggling("");
        }
    }

    const selectedState = selected && (services || []).find((s) => s.service === selected);
    const byService = Object.fromEntries((services || []).map((s) => [s.service, s]));

    return (
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-40 text-pd-text">
            <MobileBottomNav role="DRIVER" />
            <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-[max(20px,env(safe-area-inset-top))]">
                {!selectedState && (
                    <>
                        <Link href="/driver" className="flex min-h-11 items-center gap-2 self-start text-base font-extrabold text-pd-text-2">
                            <ArrowLeft size={20} aria-hidden /> Home
                        </Link>
                        <header>
                            <h1 className="text-3xl font-black">My Services</h1>
                            <p className="mt-1 text-base text-pd-text-2">
                                Turn on the work you want to do. Tap a service to see what to do next.
                            </p>
                        </header>

                        {toggleNotice && (
                            <p role="alert" className="rounded-2xl p-4 text-base font-bold"
                                style={{ background: "var(--pd-danger-soft)", color: "var(--pd-danger)" }}>
                                {toggleNotice.text}
                            </p>
                        )}
                        {error && (
                            <div className="flex flex-col gap-3 rounded-[24px] bg-pd-surface p-5 ring-1 ring-pd-line">
                                <p role="alert" className="text-base font-bold text-pd-danger">{error}</p>
                                <button type="button" onClick={() => void load()}
                                    className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-pd-accent text-lg font-extrabold text-pd-accent-ink">
                                    <RefreshCw size={20} aria-hidden /> Try again
                                </button>
                            </div>
                        )}
                        {!services && !error && (
                            <div className="flex flex-col gap-3" aria-busy="true">
                                {[0, 1, 2, 3].map((i) => (
                                    <div key={i} className="h-24 animate-pulse rounded-[24px] bg-pd-surface-2" />
                                ))}
                            </div>
                        )}

                        {services && (
                            <ul className="flex flex-col gap-3">
                                {["RIDE", "PARCEL", "BUY_DELIVER"].map((key) => byService[key] && (
                                    <li key={key}>
                                        <ServiceTile
                                            service={key} state={byService[key]}
                                            busy={toggling === key}
                                            onOpen={() => setSelected(key)}
                                            onToggle={(enabled) => quickToggle(byService[key], enabled)}
                                        />
                                    </li>
                                ))}
                                <li>
                                    <ServiceTile
                                        service="RENTAL" state={rentalPartner || {}}
                                        statusOverride={rentalTileStatus(rentalPartner)}
                                        onOpen={() => router.push("/driver/rentals")}
                                    />
                                </li>
                            </ul>
                        )}
                    </>
                )}

                {selectedState && (
                    <ServiceFlow
                        key={`${selectedState.service}:${selectedState.transportMode || ""}:${selectedState.applicationStatus}:${selectedState.status}`}
                        state={selectedState}
                        token={token}
                        onChanged={onChanged}
                        onBack={() => setSelected(null)}
                    />
                )}
            </div>
        </main>
    );
}
