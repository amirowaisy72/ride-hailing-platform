"use client";

import { useState } from "react";
import {
    CarFront, Mail, RefreshCw, Search,
    ShieldCheck, UserSearch,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

// Safar To-Do item 18 — Dashboard User Lookup by Email.
// Reads GET /admin/users/lookup?email=... (admin-auth, read-only).
// Expected response: { success, found, user, driver, vehicles,
// rides, pushDevices, rentalPartner }. On not-found:
// { success: true, found: false }. This page is read-only: it
// never sends anything and never displays secrets (no password
// hash, tokens or googleUid — the endpoint does not return them).

const formatDate = (value) =>
    value
        ? new Date(value).toLocaleDateString("en-PK", {
            day: "numeric",
            month: "short",
            year: "numeric",
        })
        : "—";

const displayName = (user) =>
    user.name ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    "—";

const displayValue = (value) =>
    value === undefined || value === null || value === ""
        ? "—"
        : String(value);

const displayYesNo = (value) =>
    value === undefined || value === null ? "—" : value ? "Yes" : "No";

function Field({ label, value }) {
    return (
        <div>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 break-words text-sm font-semibold">
                {value}
            </p>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <section className="rounded-[24px] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-extrabold">{title}</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {children}
            </div>
        </section>
    );
}

export default function UserLookupPage() {
    const [emailInput, setEmailInput] = useState("");
    const [searchedEmail, setSearchedEmail] = useState("");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [validation, setValidation] = useState("");

    async function submitSearch(event) {
        event.preventDefault();

        const email = emailInput.trim();

        if (!email) {
            setValidation("Enter an email address to search.");
            setResult(null);
            setError("");
            return;
        }

        setValidation("");
        setError("");
        setResult(null);
        setSearchedEmail(email);
        setLoading(true);

        try {
            const data = await authenticatedAdminRequest(
                `/admin/operations/users/lookup?email=${encodeURIComponent(email)}`
            );
            setResult(data || { found: false });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    const user = result?.found ? result.user || null : null;
    const driver = result?.driver || null;
    const vehicles = Array.isArray(result?.vehicles) ? result.vehicles : [];
    const rides = result?.rides || null;
    const rentalPartner = result?.rentalPartner || null;
    const documentsByStatus = driver?.documentsByStatus || null;

    return (
        <AdminShell title="User Lookup">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Account Management
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            User Lookup
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Find any user by email and see their complete
                            detail — whatever their role or status.
                        </p>
                    </div>
                </section>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <form
                        onSubmit={submitSearch}
                        className="flex flex-col gap-3 p-5 sm:flex-row"
                    >
                        <div className="flex flex-1 items-center gap-3 rounded-xl border px-4">
                            <Search size={19} className="text-slate-400" />

                            <input
                                type="search"
                                value={emailInput}
                                onChange={(e) => setEmailInput(e.target.value)}
                                placeholder="Enter email address"
                                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="rounded-xl bg-[#087F5B] px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            Search
                        </button>
                    </form>

                    {validation && (
                        <p
                            role="alert"
                            className="mx-5 mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-700"
                        >
                            {validation}
                        </p>
                    )}

                    {error && (
                        <p
                            role="alert"
                            className="mx-5 mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-600"
                        >
                            {error}
                        </p>
                    )}

                    {loading && (
                        <p className="flex items-center justify-center gap-2 p-10 text-center text-sm text-slate-500">
                            <RefreshCw size={17} className="animate-spin" />
                            Looking up user...
                        </p>
                    )}

                    {!loading && !error && result && !result.found && (
                        <div className="p-10 text-center">
                            <UserSearch
                                size={36}
                                className="mx-auto text-[#087F5B]"
                            />
                            <p className="mt-3 font-bold">
                                No user found with this email
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                                {searchedEmail}
                            </p>
                        </div>
                    )}
                </section>

                {!loading && !error && user && (
                    <div className="space-y-6">
                        <Section title="Account">
                            <Field label="Name" value={displayName(user)} />
                            <Field label="Email" value={displayValue(user.email)} />
                            <Field label="Phone" value={displayValue(user.phone)} />
                            <Field label="Role" value={displayValue(user.role)} />
                            <Field label="Status" value={displayValue(user.status)} />
                            <Field
                                label="Active mode"
                                value={displayValue(user.activeMode)}
                            />
                            <Field
                                label="Email verified"
                                value={displayYesNo(user.emailVerified)}
                            />
                            <Field
                                label="Google linked"
                                value={displayYesNo(user.googleLinked)}
                            />
                            <Field
                                label="Registered"
                                value={formatDate(user.createdAt)}
                            />
                            <Field
                                label="Invited by"
                                value={displayValue(user.invitedBy)}
                            />
                        </Section>

                        <Section title="Driver Profile">
                            {driver ? (
                                <>
                                    <Field
                                        label="Verification status"
                                        value={displayValue(driver.verificationStatus)}
                                    />
                                    <Field
                                        label="Eligibility"
                                        value={displayValue(driver.eligibility)}
                                    />
                                    {documentsByStatus &&
                                    typeof documentsByStatus === "object" ? (
                                        <div className="sm:col-span-2 lg:col-span-3">
                                            <p className="text-xs text-slate-400">
                                                Documents by status
                                            </p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {Object.entries(documentsByStatus).map(
                                                    ([status, count]) => (
                                                        <span
                                                            key={status}
                                                            className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600"
                                                        >
                                                            {status}: {count}
                                                        </span>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <Field
                                            label="Documents by status"
                                            value="—"
                                        />
                                    )}
                                </>
                            ) : (
                                <p className="text-sm text-slate-500">
                                    None — this user has no driver profile.
                                </p>
                            )}
                        </Section>

                        <section className="rounded-[24px] bg-white p-6 shadow-sm">
                            <h3 className="text-lg font-extrabold">Vehicles</h3>
                            {vehicles.length === 0 ? (
                                <p className="mt-4 text-sm text-slate-500">
                                    None — no vehicles linked to this user.
                                </p>
                            ) : (
                                <div className="mt-4 divide-y divide-slate-100">
                                    {vehicles.map((vehicle, index) => (
                                        <article
                                            key={
                                                vehicle._id ||
                                                vehicle.id ||
                                                vehicle.plateNumber ||
                                                vehicle.registrationNumber ||
                                                index
                                            }
                                            className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0"
                                        >
                                            <CarFront
                                                size={25}
                                                className="text-[#087F5B]"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold">
                                                    {displayValue(
                                                        vehicle.make ||
                                                            vehicle.brand
                                                    )}{" "}
                                                    {displayValue(vehicle.model)}
                                                </p>
                                                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                                                    <ShieldCheck size={14} />
                                                    {displayValue(
                                                        vehicle.plateNumber ||
                                                            vehicle.registrationNumber ||
                                                            vehicle.number
                                                    )}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-slate-400">
                                                    Type
                                                </p>
                                                <p className="mt-1 text-sm font-semibold">
                                                    {displayValue(vehicle.type)}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {displayValue(vehicle.status)}
                                                </p>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>

                        <Section title="Rides & Devices">
                            <Field
                                label="Total rides"
                                value={
                                    typeof rides?.total === "number"
                                        ? String(rides.total)
                                        : "—"
                                }
                            />
                            <Field
                                label="Completed rides"
                                value={
                                    typeof rides?.completed === "number"
                                        ? String(rides.completed)
                                        : "—"
                                }
                            />
                            <Field
                                label="Push devices"
                                value={
                                    typeof result.pushDevices === "number"
                                        ? String(result.pushDevices)
                                        : "—"
                                }
                            />
                        </Section>

                        <Section title="Rental Partner">
                            {rentalPartner ? (
                                <>
                                    <Field
                                        label="Business name"
                                        value={displayValue(
                                            rentalPartner.businessName ||
                                                rentalPartner.name
                                        )}
                                    />
                                    <Field
                                        label="Status"
                                        value={displayValue(rentalPartner.status)}
                                    />
                                    <Field
                                        label="Verification status"
                                        value={displayValue(
                                            rentalPartner.verificationStatus
                                        )}
                                    />
                                </>
                            ) : (
                                <p className="text-sm text-slate-500">
                                    None — this user is not a rental partner.
                                </p>
                            )}
                        </Section>

                        <p className="flex items-center gap-2 text-xs text-slate-400">
                            <Mail size={13} />
                            Lookup is read-only — nothing on this page changes
                            the account.
                        </p>
                    </div>
                )}
            </div>
        </AdminShell>
    );
}
