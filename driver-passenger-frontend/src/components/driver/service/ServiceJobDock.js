"use client";

import useSWR from "swr";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { getDriverPurchaseTasks } from "@/lib/purchaseService";
import { getPartnerRentalBookings } from "@/lib/rentalService";
import RideReturnBanner from "@/components/driver/ride/RideReturnBanner";
import { describeJobStep, JOURNEYS } from "@/components/driver/service/serviceJourneys";

const PARCEL_DONE = ["DELIVERED", "CANCELLED", "FAILED"];
const PURCHASE_ACTIVE = ["DRIVER_SELECTED", "SHOPPING", "AWAITING_APPROVAL", "PURCHASE_APPROVED", "PURCHASED", "OUT_FOR_DELIVERY", "ARRIVED"];
const RENTAL_ACTIVE = ["REQUESTED", "PROVIDER_ACCEPTED", "PAYMENT_PENDING", "CONFIRMED", "PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING"];

/** Finds the driver's unfinished job in Parcels, Buy & Deliver or Rentals (existing read APIs). */
export function useActiveServiceJob(token, enabled) {
    const options = { refreshInterval: 10000, revalidateOnFocus: true, shouldRetryOnError: false };
    const { data: parcels } = useSWR(enabled ? ["svc-parcels", token] : null, () => apiRequest("/parcels/driver/my", { token }), options);
    const { data: purchases } = useSWR(enabled ? ["svc-purchases", token] : null, () => getDriverPurchaseTasks(token), options);
    const { data: rentals } = useSWR(enabled ? ["svc-rentals", token] : null, () => getPartnerRentalBookings(token), options);

    const parcel = (parcels?.orders || []).find((o) => !PARCEL_DONE.includes(o.status));
    if (parcel) return { service: "PARCEL", status: parcel.status, href: `/driver/parcels/details?parcelId=${parcel._id}` };
    const purchase = (purchases?.orders || purchases?.tasks || []).find((o) => PURCHASE_ACTIVE.includes(o.status));
    if (purchase) return { service: "BUY_DELIVER", status: purchase.status, href: `/driver/buy-deliver/details?id=${purchase._id}` };
    const rental = (rentals?.bookings || []).find((b) => RENTAL_ACTIVE.includes(b.status));
    if (rental) return { service: "RENTAL", status: rental.status, href: `/driver/rentals/bookings/details?id=${rental._id}` };
    return null;
}

const NOUN = { PARCEL: "delivery", BUY_DELIVER: "shopping order", RENTAL: "rental" };

/**
 * Always-visible way back to an unfinished Parcel, Buy & Deliver or Rental job.
 * Sits above the ride banner; hides on the job screen itself.
 */
export default function ServiceJobDock() {
    const { token } = useAuth();
    const pathname = usePathname();
    const onJobScreen = /\/(details|bookings\/details)$/.test(pathname || "");
    const enabled = Boolean(token) && !onJobScreen;
    const job = useActiveServiceJob(token, enabled);
    if (!enabled || !job) return null;

    const info = describeJobStep(job.service, job.status);
    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(148px+env(safe-area-inset-bottom))] z-[124] mx-auto w-full max-w-xl px-3">
            <RideReturnBanner
                kind="active" href={job.href}
                title={`Your current ${NOUN[job.service]}`}
                subtitle={info ? `${JOURNEYS[job.service].label} · ${info.title}` : "Tap to continue"}
            />
        </div>
    );
}
