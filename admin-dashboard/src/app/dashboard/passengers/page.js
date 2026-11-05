
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ChevronLeft, ChevronRight, Mail, Phone,
    RefreshCw, Search, UserRound, Users,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import ProfilePhotoViewer, {
    ProfileAvatar,
} from "@/components/ProfilePhotoViewer";
import ProfileModal from "@/components/ProfileModal";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const formatDate = (value) =>
    value
        ? new Date(value).toLocaleDateString("en-PK", {
            day: "numeric",
            month: "short",
            year: "numeric",
        })
        : "—";

const displayName = (user) =>
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.name ||
    "Passenger";

// Relative "last active" for the Most Active sort. Users on builds
// older than the app-version reporting feature have no row, so they
// show as never seen and sort last.
function timeAgo(value) {
    if (!value) return "Never seen";
    const seconds = Math.floor((Date.now() - new Date(value)) / 1000);
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 86400 * 30)
        return `${Math.floor(seconds / 86400)} days ago`;
    return formatDate(value);
}

export default function PassengersPage() {
    const [passengers, setPassengers] = useState([]);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [photoViewer, setPhotoViewer] = useState(null);
    const [sort, setSort] = useState("recent");
    const [profileOpen, setProfileOpen] = useState(false);
    const [profile, setProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState("");
    const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);

    const loadPassengers = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({
                page: String(page),
                sort,
            });

            if (search) params.set("search", search);

            const data = await authenticatedAdminRequest(
                `/admin/operations/passengers?${params.toString()}`
            );

            setPassengers(data.passengers || []);
            setPagination(data.pagination || {});
        } catch (err) {
            setPassengers([]);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, search, sort]);

    useEffect(() => {
        loadPassengers();
    }, [loadPassengers]);

    // Deep link from a rental booking (?q=name or email): pre-fill the
    // search so the passenger's row is shown straight away.
    useEffect(() => {
        const q = new URLSearchParams(window.location.search).get("q");
        if (q) {
            setSearchInput(q);
            setSearch(q);
            setPage(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function submitSearch(event) {
        event.preventDefault();
        setPage(1);
        setSearch(searchInput.trim());
    }

    // Full profile modal: one read-only request, opened by clicking
    // the passenger's name. Nothing is changed or sent from here.
    async function openProfile(passenger) {
        setProfile(null);
        setProfileError("");
        setProfileLoading(true);
        setProfileOpen(true);
        setProfilePhotoUrl(passenger.profileImage || null);

        try {
            const data = await authenticatedAdminRequest(
                `/admin/operations/passengers/${encodeURIComponent(passenger._id)}/profile`
            );
            setProfile(data.profile || null);
        } catch (err) {
            setProfileError(err.message);
        } finally {
            setProfileLoading(false);
        }
    }

    return (
        <AdminShell title="Passenger Management">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Account Management
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            Passenger Accounts
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            View and search registered platform passengers.
                        </p>
                    </div>

                    <button
                        type="button"
                        disabled={loading}
                        onClick={loadPassengers}
                        className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                        <RefreshCw
                            size={17}
                            className={loading ? "animate-spin" : ""}
                        />
                        Refresh
                    </button>
                </section>

                <div className="rounded-2xl bg-white p-5 shadow-sm">
                    <Users size={25} className="text-[#087F5B]" />
                    <p className="mt-3 text-sm text-slate-500">
                        Registered Passengers
                    </p>
                    <p className="mt-1 text-3xl font-extrabold">
                        {loading ? "—" : pagination.total ?? 0}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                        Total matching current search
                    </p>
                </div>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <form
                        onSubmit={submitSearch}
                        className="flex flex-col gap-3 border-b p-5 sm:flex-row"
                    >
                        <div className="flex flex-1 items-center gap-3 rounded-xl border px-4">
                            <Search size={19} className="text-slate-400" />

                            <input
                                type="search"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder="Search by name, email or phone"
                                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>

                        <button
                            type="submit"
                            className="rounded-xl bg-[#087F5B] px-6 py-3 text-sm font-bold text-white"
                        >
                            Search
                        </button>
                    </form>

                    <div className="flex flex-wrap gap-2 border-b p-5">
                        {[
                            ["recent", "Newest"],
                            ["active", "Most Active"],
                            ["rides", "Most Rides"],
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => {
                                    setPage(1);
                                    setSort(value);
                                }}
                                className={`rounded-xl px-4 py-2 text-xs font-bold ${sort === value
                                    ? "bg-[#087F5B] text-white"
                                    : "bg-slate-100 text-slate-600"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                        <p className="w-full text-xs text-slate-400">
                            Most Active sorts by last app open (most recent
                            first); users who never opened a reporting build
                            sort last. Most Rides sorts by booked rides.
                        </p>
                    </div>

                    {error && (
                        <p
                            role="alert"
                            className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-600"
                        >
                            {error}
                        </p>
                    )}

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading passenger accounts...
                        </p>
                    ) : !error && passengers.length === 0 ? (
                        <div className="p-10 text-center">
                            <UserRound
                                size={36}
                                className="mx-auto text-[#087F5B]"
                            />
                            <p className="mt-3 font-bold">
                                No passengers found
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {passengers.map((passenger) => (
                                <article
                                    key={passenger._id}
                                    className="flex flex-wrap items-center gap-4 p-5"
                                >
                                    <ProfileAvatar
                                        url={passenger.profileImage || null}
                                        name={displayName(passenger)}
                                        size={48}
                                        onOpen={setPhotoViewer}
                                    />

                                    <div className="min-w-0 flex-1">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                openProfile(passenger)
                                            }
                                            className="text-left font-bold hover:underline"
                                            title="Open full profile"
                                        >
                                            {displayName(passenger)}
                                        </button>

                                        <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-slate-500">
                                            <Mail size={14} />
                                            {passenger.email}
                                        </p>

                                        {passenger.phone ? (
                                            <a
                                                href={`tel:${passenger.phone}`}
                                                className="mt-1 flex items-center gap-1.5 truncate text-sm font-semibold text-[#087F5B]"
                                            >
                                                <Phone size={14} />
                                                {passenger.phone}
                                            </a>
                                        ) : (
                                            <p className="mt-1 text-sm text-slate-400">
                                                No phone number
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-xs text-slate-400">
                                            Registered
                                        </p>
                                        <p className="mt-1 text-sm font-semibold">
                                            {formatDate(passenger.createdAt)}
                                        </p>
                                        {passenger.lastActiveAt !==
                                            undefined && (
                                            <p className="mt-1 text-xs text-slate-500">
                                                Last active{" "}
                                                {timeAgo(
                                                    passenger.lastActiveAt
                                                )}
                                            </p>
                                        )}
                                        {typeof passenger.rideCount ===
                                            "number" && (
                                            <p className="mt-1 text-xs font-bold text-slate-500">
                                                {passenger.rideCount} ride(s)
                                            </p>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}

                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-between gap-3 border-t p-5">
                            <button
                                type="button"
                                disabled={loading || page <= 1}
                                onClick={() => setPage((p) => p - 1)}
                                className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                <ChevronLeft size={17} />
                                Previous
                            </button>

                            <span className="text-sm text-slate-500">
                                {page} / {pagination.pages}
                            </span>

                            <button
                                type="button"
                                disabled={loading || page >= pagination.pages}
                                onClick={() => setPage((p) => p + 1)}
                                className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                Next
                                <ChevronRight size={17} />
                            </button>
                        </div>
                    )}
                </section>
            </div>
            <ProfilePhotoViewer
                photo={photoViewer}
                onClose={() => setPhotoViewer(null)}
            />
            <ProfileModal
                open={profileOpen}
                onClose={() => setProfileOpen(false)}
                kind="passenger"
                profile={profile}
                loading={profileLoading}
                error={profileError}
                photoUrl={profilePhotoUrl}
                onViewPhoto={setPhotoViewer}
            />
        </AdminShell>
    );
}
