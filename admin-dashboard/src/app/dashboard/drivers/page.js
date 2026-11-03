
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    CarFront, CheckCircle2, Clock3, RefreshCw,
    Search, ShieldCheck, XCircle, UserRound,
    AlertCircle, ChevronLeft, ChevronRight, Bell,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { useAdminDialog } from "@/components/AdminDialog";
import { authenticatedAdminRequest } from "@/lib/adminSession";
import DriverDocumentReview from "@/components/DriverDocumentReview";
import DriverServicesPanel from "@/components/DriverServicesPanel";
import ProfileModal from "@/components/ProfileModal";
import ProfilePhotoViewer, {
    ProfileAvatar,
} from "@/components/ProfilePhotoViewer";

const statuses = {
    APPROVED: "bg-emerald-50 text-emerald-700",
    PENDING: "bg-amber-50 text-amber-700",
    REJECTED: "bg-red-50 text-red-700",
    SUSPENDED: "bg-red-50 text-red-700",
};

const DRIVERS_PAGE_SIZE = 20;

const nameOf = (driver) =>
    [
        driver.userId?.firstName,
        driver.userId?.lastName,
    ].filter(Boolean).join(" ") ||
    driver.userId?.name ||
    driver.name ||
    "Driver";

// Last seen in the app: the later of the last app open (reported on
// launch/login) and the last driver-location ping. Users on builds
// older than the reporting feature have no app-open row, so the
// location ping alone still places them.
function lastActiveOf(driver) {
    const candidates = [driver.lastActiveAt, driver.lastLocationUpdate]
        .filter(Boolean)
        .map((value) => new Date(value));
    if (candidates.length === 0) return null;
    return new Date(Math.max(...candidates.map((date) => date.getTime())));
}

function timeAgo(value) {
    if (!value) return "Never seen";
    const seconds = Math.floor((Date.now() - new Date(value)) / 1000);
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 86400 * 30)
        return `${Math.floor(seconds / 86400)} days ago`;
    return new Date(value).toLocaleDateString("en-PK", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export default function DriversPage() {
    const { confirmDialog, promptDialog } = useAdminDialog();
    const [drivers, setDrivers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busyId, setBusyId] = useState(null);
    const [reviewDriver, setReviewDriver] = useState(null);
    const [servicesDriver, setServicesDriver] = useState(null);
    const [filter, setFilter] = useState("ALL");
    const [search, setSearch] = useState("");
    const [photoViewer, setPhotoViewer] = useState(null);
    const [page, setPage] = useState(1);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [sortMode, setSortMode] = useState("recent");
    const [profileOpen, setProfileOpen] = useState(false);
    const [profile, setProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState("");
    const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);

    const loadDrivers = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/drivers"
            );

            const records = Array.isArray(data.drivers)
                ? data.drivers
                : [];

            setDrivers(records);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDrivers();
    }, [loadDrivers]);

    // Full profile modal: one read-only request, opened by clicking
    // the driver's name. Nothing is changed or sent from here.
    async function openProfile(driver) {
        setProfile(null);
        setProfileError("");
        setProfileLoading(true);
        setProfileOpen(true);
        setProfilePhotoUrl(
            driver.profilePhotoUrl || driver.userId?.profileImage || null
        );

        try {
            const data = await authenticatedAdminRequest(
                `/admin/drivers/${encodeURIComponent(driver._id || driver.driverId)}/profile`
            );
            setProfile(data.profile || null);
        } catch (err) {
            setProfileError(err.message);
        } finally {
            setProfileLoading(false);
        }
    }

    async function updateDriver(driverId, action) {
        if (busyId) return;

        const label = action === "approve" ? "approve" : "reject";

        let rejectionReason = "";

        if (action === "reject") {
            const reason = await promptDialog("Enter rejection reason:");
            if (!reason?.trim()) return;
            rejectionReason = reason.trim();
        } else if (!(await confirmDialog(`Are you sure you want to ${label} this driver?`))) {
            return;
        }

        setBusyId(driverId);
        setError("");
        setMessage("");

        try {
            // Approval route compatibility will be verified
            // against the existing backend controller.
            const path = `/admin/drivers/${driverId}/status`;

            await authenticatedAdminRequest(path, {
                method: "PATCH",
                body: JSON.stringify({
                    status: action === "approve" ? "APPROVED" : "REJECTED",
                    ...(action === "reject" ? { rejectionReason } : {}),
                }),
            });

            setMessage(`Driver ${label} action completed.`);
            await loadDrivers();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    }

    // Missing-documents push: preview the exact message first,
    // confirm it, then send. Nothing is sent without the confirm.
    async function notifyMissingDocuments(driverId) {
        if (busyId) return;

        setBusyId(driverId);
        setError("");
        setMessage("");

        try {
            const preview = await authenticatedAdminRequest(
                `/admin/drivers/${driverId}/missing-documents`
            );

            if (!preview.missing?.length) {
                setMessage("No documents are missing for this driver.");
                return;
            }

            if (!preview.hasPushDevice) {
                setError("This driver has no registered push-enabled device.");
                return;
            }

            const confirmed = await confirmDialog(
                `Send this push notification to ${preview.driverName}? "${preview.title}" — ${preview.body}`
            );
            if (!confirmed) return;

            const result = await authenticatedAdminRequest(
                `/admin/drivers/${driverId}/notify-missing-documents`,
                { method: "POST" }
            );

            setMessage(result.message || "Notification sent.");
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    }

    // Bulk missing-documents push: one button, one preview, one
    // confirm — then every driver with missing documents gets their
    // OWN list (name + their missing types). Nothing is sent before
    // the admin sees the counts and sample messages and confirms.
    // Drivers without a push device are counted and skipped.
    async function notifyAllMissingDocuments() {
        if (bulkBusy) return;

        setBulkBusy(true);
        setError("");
        setMessage("");

        try {
            const preview = await authenticatedAdminRequest(
                "/admin/drivers/notify-all-missing-documents-preview"
            );

            if (!preview.notifyCount) {
                setMessage(
                    preview.totalMissing
                        ? `${preview.totalMissing} driver(s) have missing documents, but none has a registered push device.`
                        : "No drivers with missing documents."
                );
                return;
            }

            const sampleLines = (preview.samples || [])
                .map((sample) => `${sample.name}: "${sample.body}"`)
                .join("\n");
            const confirmed = await confirmDialog(
                `Send missing-documents notifications to ${preview.notifyCount} driver(s)?` +
                    (preview.skippedNoDevice
                        ? ` ${preview.skippedNoDevice} driver(s) will be skipped (no push device).`
                        : "") +
                    "\n\nEach driver gets their own missing list. Samples:\n" +
                    sampleLines
            );
            if (!confirmed) return;

            const result = await authenticatedAdminRequest(
                "/admin/drivers/notify-all-missing-documents",
                { method: "POST" }
            );

            setMessage(
                `Sent to ${result.sent} driver(s).` +
                    (result.skippedNoDevice
                        ? ` Skipped ${result.skippedNoDevice} (no push device).`
                        : "") +
                    (result.failed
                        ? ` Failed ${result.failed}.`
                        : "")
            );
        } catch (err) {
            setError(err.message);
        } finally {
            setBulkBusy(false);
        }
    }

    const visible = drivers.filter((driver) => {
        // New filter: PENDING status AND at least one submitted document
        // (any document status counts as submitted, not only approved).
        const matchesStatus =
            filter === "ALL" ||
            (filter === "PENDING_WITH_DOCS"
                ? driver.verificationStatus === "PENDING" &&
                  (driver.documentCount || 0) > 0
                : driver.verificationStatus === filter);

        const query = search.trim().toLowerCase();

        const matchesSearch =
            !query ||
            nameOf(driver).toLowerCase().includes(query) ||
            (driver.userId?.email || "")
                .toLowerCase().includes(query);

        return matchesStatus && matchesSearch;
    });

    // Client-side pagination (the drivers endpoint returns the full
    // list, so paging here needs no backend change). Filter/search
    // changes reset to page 1, so the list can never strand the
    // admin on an empty page.
    useEffect(() => {
        setPage(1);
    }, [filter, search, sortMode]);

    // Most Active sorts the filtered list by last seen (app open or
    // location ping, whichever is later); never-seen drivers sort
    // last. Pagination slices the sorted list, so paging stays
    // consistent with the order shown.
    const sortedVisible =
        sortMode === "active"
            ? [...visible].sort((a, b) => {
                  const timeA = lastActiveOf(a)?.getTime() || 0;
                  const timeB = lastActiveOf(b)?.getTime() || 0;
                  if (timeB !== timeA) return timeB - timeA;
                  return (
                      new Date(b.createdAt) - new Date(a.createdAt)
                  );
              })
            : visible;

    const totalPages = Math.max(
        1,
        Math.ceil(visible.length / DRIVERS_PAGE_SIZE)
    );
    const currentPage = Math.min(page, totalPages);
    const pagedDrivers = sortedVisible.slice(
        (currentPage - 1) * DRIVERS_PAGE_SIZE,
        currentPage * DRIVERS_PAGE_SIZE
    );
    const showingFrom =
        visible.length === 0
            ? 0
            : (currentPage - 1) * DRIVERS_PAGE_SIZE + 1;
    const showingTo = Math.min(
        visible.length,
        currentPage * DRIVERS_PAGE_SIZE
    );

    const countStatus = (status) =>
        drivers.filter((d) => d.verificationStatus === status).length;

    const countPendingWithDocs = drivers.filter(
        (d) =>
            d.verificationStatus === "PENDING" &&
            (d.documentCount || 0) > 0
    ).length;

    return (
        <AdminShell title="Driver Management">
            <div className="space-y-6">
                <section className="rounded-[24px] bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                                Verification & Operations
                            </p>
                            <h2 className="mt-2 text-2xl font-extrabold">
                                Driver Management
                            </h2>
                            <p className="mt-2 text-sm text-slate-500">
                                Review registered drivers, verification status
                                and approval requests.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={loadDrivers}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                        >
                            <RefreshCw
                                size={18}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </section>

                <div className="grid gap-4 sm:grid-cols-3">
                    {[
                        {
                            label: "Total Drivers",
                            value: drivers.length,
                            icon: UserRound,
                        },
                        {
                            label: "Approved",
                            value: countStatus("APPROVED"),
                            icon: CheckCircle2,
                        },
                        {
                            label: "Pending",
                            value: countStatus("PENDING"),
                            icon: Clock3,
                        },
                    ].map(({ label, value, icon: Icon }) => (
                        <div
                            key={label}
                            className="rounded-2xl bg-white p-5 shadow-sm"
                        >
                            <Icon size={24} className="text-[#087F5B]" />
                            <p className="mt-4 text-sm text-slate-500">
                                {label}
                            </p>
                            <p className="mt-1 text-3xl font-extrabold">
                                {loading ? "—" : value}
                            </p>
                        </div>
                    ))}
                </div>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <div className="space-y-4 border-b p-5">
                        <div className="flex items-center gap-3 rounded-xl border px-4">
                            <Search size={19} className="text-slate-400" />
                            <input
                                type="search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search drivers by name or email"
                                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {["ALL", "PENDING", "APPROVED", "REJECTED"].map((status) => (
                                <button
                                    key={status}
                                    type="button"
                                    onClick={() => setFilter(status)}
                                    className={`rounded-xl px-4 py-2 text-xs font-bold ${filter === status
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-slate-100 text-slate-600"
                                        }`}
                                >
                                    {status === "ALL" ? "All Drivers" : status}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setFilter("PENDING_WITH_DOCS")}
                                className={`rounded-xl px-4 py-2 text-xs font-bold ${filter === "PENDING_WITH_DOCS"
                                    ? "bg-[#087F5B] text-white"
                                    : "bg-slate-100 text-slate-600"
                                    }`}
                            >
                                {`PENDING + DOCS (${countPendingWithDocs})`}
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-slate-500">
                                Sort:
                            </span>
                            {[
                                ["recent", "Newest"],
                                ["active", "Most Active"],
                            ].map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setSortMode(value)}
                                    className={`rounded-xl px-4 py-2 text-xs font-bold ${sortMode === value
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-slate-100 text-slate-600"
                                        }`}
                                >
                                    {label}
                                </button>
                            ))}
                            <p className="w-full text-xs text-slate-400">
                                Most Active sorts by last seen in the app
                                (last app open or last location ping,
                                whichever is later); never-seen drivers
                                sort last.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-slate-400">
                                Bulk notify sends each driver with missing
                                documents their own list — nothing is sent
                                before a preview and a confirm.
                            </p>
                            <button
                                type="button"
                                disabled={bulkBusy}
                                onClick={notifyAllMissingDocuments}
                                className="flex items-center gap-2 rounded-xl border border-amber-200 px-4 py-2.5 text-sm font-bold text-amber-700 disabled:opacity-50"
                            >
                                <Bell size={16} />
                                Notify All Missing Docs
                            </button>
                        </div>
                    </div>

                    {message && (
                        <p
                            role="status"
                            className="m-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-[#087F5B]"
                        >
                            {message}
                        </p>
                    )}

                    {error && (
                        <p
                            role="alert"
                            className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-600"
                        >
                            <AlertCircle size={16} className="mr-2 inline" />
                            {error}
                        </p>
                    )}

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading drivers...
                        </p>
                    ) : visible.length === 0 ? (
                        <div className="p-10 text-center">
                            <CarFront
                                size={35}
                                className="mx-auto text-[#087F5B]"
                            />
                            <p className="mt-3 font-bold">No drivers found</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {pagedDrivers.map((driver) => {
                                const status = driver.verificationStatus || "PENDING";
                                const driverId = driver._id || driver.driverId;

                                return (
                                    <div
                                        key={driverId}
                                        className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[56px_minmax(0,1fr)_230px_320px] lg:items-center"
                                    >
                                        <ProfileAvatar
                                            url={
                                                driver.profilePhotoUrl ||
                                                driver.userId?.profileImage ||
                                                null
                                            }
                                            name={nameOf(driver)}
                                            size={56}
                                            onOpen={setPhotoViewer}
                                        />

                                        <div className="min-w-0">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    openProfile(driver)
                                                }
                                                className="truncate text-left font-bold hover:underline"
                                                title={`${nameOf(driver)} — open full profile`}
                                            >
                                                {nameOf(driver)}
                                            </button>
                                            <p
                                                className="truncate text-sm text-slate-500"
                                                title={driver.userId?.email || ""}
                                            >
                                                {driver.userId?.email || "Email unavailable"}
                                            </p>
                                            {driver.userId?.phone ? (
                                                <a
                                                    href={`tel:${driver.userId.phone}`}
                                                    className="mt-1 block truncate text-sm font-semibold text-[#087F5B]"
                                                >
                                                    {driver.userId.phone}
                                                </a>
                                            ) : (
                                                <p className="mt-1 text-sm text-slate-400">
                                                    No phone number
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex flex-col gap-1.5">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span
                                                    className={`inline-block rounded-lg px-3 py-1 text-xs font-bold ${statuses[status] || "bg-slate-100 text-slate-600"
                                                        }`}
                                                >
                                                    {status}
                                                </span>
                                                {typeof driver.documentCount === "number" && (
                                                    <span className="text-xs font-bold text-slate-500">
                                                        {driver.documentCount} document(s)
                                                    </span>
                                                )}
                                                <span className="text-xs text-slate-500">
                                                    Last active{" "}
                                                    {timeAgo(
                                                        lastActiveOf(driver)
                                                    )}
                                                </span>
                                            </div>

                                            {/* Phase 7 — per-service records at a glance
                                                (stored statuses; the Services panel shows
                                                the evaluated eligibility). */}
                                            <div className="flex flex-wrap gap-1.5">
                                                {[
                                                    ["RIDE", "Ride"],
                                                    ["PARCEL", "Parcel"],
                                                    ["BUY_DELIVER", "Buy & Deliver"],
                                                ].map(([key, label]) => {
                                                    const serviceStatus =
                                                        driver.services?.[key]?.status || "NOT_APPLIED";
                                                    return (
                                                        <span
                                                            key={key}
                                                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${statuses[serviceStatus] || "bg-slate-100 text-slate-500"
                                                                }`}
                                                        >
                                                            {label}: {serviceStatus.replaceAll("_", " ")}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-2 lg:justify-end">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setReviewDriver({
                                                        id: driverId,
                                                        name: nameOf(driver),
                                                    })
                                                }
                                            className="rounded-xl border border-emerald-200 px-4 py-3 text-sm font-bold text-[#087F5B]"
                                        >
                                            Review Documents
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                setServicesDriver({
                                                    id: driverId,
                                                    name: nameOf(driver),
                                                })
                                            }
                                            className="rounded-xl border border-emerald-200 px-4 py-3 text-sm font-bold text-[#087F5B]"
                                        >
                                            Services
                                        </button>

                                        {["PENDING", "UNDER_REVIEW"].includes(status) && (
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={Boolean(busyId)}
                                                    onClick={() => notifyMissingDocuments(driverId)}
                                                    className="flex items-center gap-2 rounded-xl border border-amber-200 px-4 py-3 text-sm font-bold text-amber-700 disabled:opacity-50"
                                                >
                                                    <Bell size={16} />
                                                    Notify Missing Docs
                                                </button>

                                                <button
                                                    type="button"
                                                    disabled={Boolean(busyId)}
                                                    onClick={() => updateDriver(driverId, "approve")}
                                                    className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                                                >
                                                    <CheckCircle2 size={16} />
                                                    Approve
                                                </button>

                                                <button
                                                    type="button"
                                                    disabled={Boolean(busyId)}
                                                    onClick={() => updateDriver(driverId, "reject")}
                                                    className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-600 disabled:opacity-50"
                                                >
                                                    <XCircle size={16} />
                                                    Reject
                                                </button>
                                            </div>
                                        )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {visible.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-5">
                            <p className="text-sm text-slate-500">
                                Showing {showingFrom}–{showingTo} of{" "}
                                {visible.length} drivers
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={currentPage <= 1}
                                    onClick={() => setPage(currentPage - 1)}
                                    className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                                >
                                    <ChevronLeft size={17} />
                                    Previous
                                </button>
                                <span className="text-sm text-slate-500">
                                    {currentPage} / {totalPages}
                                </span>
                                <button
                                    type="button"
                                    disabled={currentPage >= totalPages}
                                    onClick={() => setPage(currentPage + 1)}
                                    className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                                >
                                    Next
                                    <ChevronRight size={17} />
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
            <ProfilePhotoViewer
                photo={photoViewer}
                onClose={() => setPhotoViewer(null)}
            />
            {reviewDriver && (
                <DriverDocumentReview
                    driverId={reviewDriver.id}
                    driverName={reviewDriver.name}
                    onClose={() => setReviewDriver(null)}
                    onUpdated={loadDrivers}
                />
            )}
            {servicesDriver && (
                <DriverServicesPanel
                    driverId={servicesDriver.id}
                    driverName={servicesDriver.name}
                    onClose={() => setServicesDriver(null)}
                    onUpdated={loadDrivers}
                />
            )}
            <ProfileModal
                open={profileOpen}
                onClose={() => setProfileOpen(false)}
                kind="driver"
                profile={profile}
                loading={profileLoading}
                error={profileError}
                photoUrl={profilePhotoUrl}
                onViewPhoto={setPhotoViewer}
                onReviewDocuments={
                    profile?.driver?._id
                        ? () => {
                              const driverId = profile.driver._id;
                              const name = profile.user
                                  ? [
                                        profile.user.firstName,
                                        profile.user.lastName,
                                    ]
                                      .filter(Boolean)
                                      .join(" ") ||
                                    profile.user.name ||
                                    "Driver"
                                  : "Driver";
                              setProfileOpen(false);
                              setReviewDriver({ id: driverId, name });
                          }
                        : null
                }
            />
        </AdminShell>
    );
}

