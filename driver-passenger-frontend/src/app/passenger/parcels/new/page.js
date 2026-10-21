"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Geolocation } from "@capacitor/geolocation";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { searchLocations, reverseGeocode } from "@/lib/locationService";
import RideMap from "@/components/RideMap";

export default function NewParcelPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ParcelBookingForm />
        </AuthGuard>
    );
}

function ParcelBookingForm() {
    const { token } = useAuth();
    const router = useRouter();

    const [serviceType, setServiceType] = useState("SEND_PARCEL");
    const [bookingStep, setBookingStep] = useState(1);
    const [mapSelectionMode, setMapSelectionMode] = useState(null);
    const [pickup, setPickup] = useState(null);
    const [destination, setDestination] = useState(null);
    const [pickupQuery, setPickupQuery] = useState("");
    const [destinationQuery, setDestinationQuery] = useState("");
    const [results, setResults] = useState([]);
    const [activeSearch, setActiveSearch] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searchLocation, setSearchLocation] = useState(null);
    const searchTimer = useRef(null);

    useEffect(() => {
        return () => clearTimeout(searchTimer.current);
    }, []);
    const [error, setError] = useState("");

    const [sender, setSender] = useState({ name: "", phone: "" });
    const [receiver, setReceiver] = useState({ name: "", phone: "" });
    const [category, setCategory] = useState("OTHER");
    const [description, setDescription] = useState("");
    const [weightKg, setWeightKg] = useState("1");
    const [quantity, setQuantity] = useState("1");
    const [vehicleType, setVehicleType] = useState("BIKE");
    const [requestedPrice, setRequestedPrice] = useState("");
    const [paymentBy, setPaymentBy] = useState("SENDER");
    const [instructions, setInstructions] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function findPlaces(query, field) {
        if (field === "pickup") {
            setPickupQuery(query);
            setPickup(null);
        } else {
            setDestinationQuery(query);
            setDestination(null);
        }

        setActiveSearch(field);
        setResults([]);

        if (query.trim().length < 3) return;

        setSearching(true);
        try {
            let location = searchLocation;

            if (!location) {
                const position = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 15000,
                });

                location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                };

                setSearchLocation(location);
            }

            const places = await searchLocations(query, token, location);
            setResults(places || []);
        } catch (e) {
            setError(e.message);
        } finally {
            setSearching(false);
        }
    }

    function choosePlace(place) {
        const point = {
            latitude: Number(place.latitude),
            longitude: Number(place.longitude),
            address: place.display_name || place.name || "",
        };

        if (activeSearch === "pickup") {
            setPickup(point);
            setPickupQuery(point.address);
        } else {
            setDestination(point);
            setDestinationQuery(point.address);
        }

        setResults([]);
        setActiveSearch(null);
    }

    async function useCurrentPickup() {
        try {
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 15000,
            });

            setSearchLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
            });

            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            let address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

            try {
                const result = await reverseGeocode(latitude, longitude, token);
                address = result?.display_name || result?.address || result?.name || address;
                if (typeof address !== "string") {
                    address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                }
            } catch {
                // Keep accurate GPS coordinates if address lookup fails.
            }

            setPickup({ latitude, longitude, address });
            setPickupQuery(address);
            setResults([]);
        } catch (e) {
            setError(e.message);
        }
    }

    async function selectLocationOnMap(point) {
        const field = mapSelectionMode || activeSearch || (pickup ? "destination" : "pickup");
        setMapSelectionMode(null);
        const { latitude, longitude } = point;

        setError("");
        setResults([]);
        setActiveSearch(null);

        const fallback = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        const selected = { latitude, longitude, address: fallback };

        if (field === "pickup") {
            setPickup(selected);
            setPickupQuery(fallback);
        } else {
            setDestination(selected);
            setDestinationQuery(fallback);
        }

        try {
            const result = await reverseGeocode(latitude, longitude, token);
            const address = typeof result === "string"
                ? result
                : result?.display_name || result?.address || result?.name;

            if (typeof address !== "string" || !address.trim()) return;

            const updated = { latitude, longitude, address };

            if (field === "pickup") {
                setPickup(updated);
                setPickupQuery(address);
            } else {
                setDestination(updated);
                setDestinationQuery(address);
            }
        } catch {
            // Coordinates remain selected if address lookup fails.
        }
    }

    async function submitParcel(event) {
        event.preventDefault();
        if (!pickup || !destination || submitting) {
            setError("Select pickup and delivery locations.");
            return;
        }

        setSubmitting(true);
        setError("");

        try {
            const data = await apiRequest("/parcels", {
                method: "POST",
                token,
                body: JSON.stringify({
                    serviceType,
                    pickup,
                    destination,
                    sender,
                    receiver,
                    parcel: {
                        category,
                        description,
                        weightKg: Number(weightKg),
                        quantity: Number(quantity),
                    },
                    vehicleType,
                    requestedPrice: Number(requestedPrice),
                    paymentBy,
                    instructions,
                }),
            });

            router.push(`/passenger/parcels/details?parcelId=${data.order._id}`);
        } catch (e) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className={`min-h-dvh bg-[#F4F5F7] text-[#111111] ${bookingStep === 1 ? "p-0" : "p-4"}`}>
            <div className={bookingStep === 1 ? "relative h-dvh overflow-hidden" : "mx-auto max-w-xl"}>
                <Link
                    href="/passenger/parcels"
                    className={`text-sm font-bold ${bookingStep === 1 ? "absolute left-4 top-4 z-30 rounded-full bg-white px-4 py-3 shadow-lg" : ""}`}
                >
                    ← Back
                </Link>

                <h1 className={bookingStep === 1 ? "sr-only" : "my-5 text-2xl font-extrabold"}>
                    📦 Book Parcel Delivery
                </h1>

                {bookingStep === 1 && (
                    <div className="mb-4">
                        {mapSelectionMode && (
                            <div className="absolute left-4 right-4 top-20 z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl bg-[#111111] p-4 text-white shadow-xl">
                                <p className="text-sm font-bold">
                                    📍 Tap map to set {mapSelectionMode === "pickup" ? "Pickup" : "Delivery"} location
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setMapSelectionMode(null)}
                                    className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-black"
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                        <p className="mb-2 text-sm font-bold">
                            Select pickup and delivery on the map
                        </p>
                        <div className="fixed inset-0 z-0 overflow-hidden bg-gray-200">
                            <RideMap
                                userLocation={pickup}
                                destination={destination}
                                onMapClick={selectLocationOnMap}
                                showNavigationControl
                            />
                        </div>
                        <p className="sr-only">
                            Select pickup and delivery using the map or address search.
                        </p>
                    </div>
                )}

                <form
                    onSubmit={submitParcel}
                    noValidate={bookingStep === 1}
                    className={
                        bookingStep === 1
                            ? `absolute inset-x-4 bottom-4 z-20 mx-auto max-w-xl max-h-[65dvh] space-y-3 overflow-y-auto rounded-3xl bg-white/95 p-4 shadow-2xl backdrop-blur ${mapSelectionMode ? "hidden" : ""}`
                            : "space-y-4"
                    }
                >
                    {bookingStep === 1 && (
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                ["SEND_PARCEL", "Send Parcel"],
                                ["SHOP_PICKUP", "Shop Pickup"],
                            ].map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setServiceType(id)}
                                    className={`rounded-2xl p-4 text-sm font-bold ${serviceType === id
                                        ? "bg-[#C1F11D]"
                                        : "bg-white"
                                        }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}

                    {bookingStep === 1 && (
                        <p className="text-center text-sm font-bold">
                            {!pickup ? "📍 Select Pickup Location" : !destination ? "📍 Select Delivery Location" : "✓ Both Locations Selected"}
                        </p>
                    )}

                    {bookingStep === 1 && ["pickup", "destination"].map((field) => (
                        <div key={field} className="relative rounded-2xl bg-white p-4">
                            <label className="mb-2 block text-sm font-bold">
                                {field === "pickup"
                                    ? "Pickup Location"
                                    : "Delivery Location"}
                            </label>

                            <input
                                value={field === "pickup" ? pickupQuery : destinationQuery}
                                onChange={(e) => {
                                    const value = e.target.value;

                                    clearTimeout(searchTimer.current);

                                    if (field === "pickup") {
                                        setPickupQuery(value);
                                        setPickup(null);
                                    } else {
                                        setDestinationQuery(value);
                                        setDestination(null);
                                    }

                                    setActiveSearch(field);
                                    setResults([]);

                                    if (value.trim().length >= 3) {
                                        searchTimer.current = setTimeout(() => {
                                            findPlaces(value, field);
                                        }, 500);
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        clearTimeout(searchTimer.current);
                                        findPlaces(e.currentTarget.value, field);
                                    }
                                }}
                                placeholder="Search address or place"
                                className="w-full rounded-xl bg-[#F4F5F7] p-3 outline-none"
                                required
                            />

                            <button
                                type="button"
                                onClick={() => {
                                    setMapSelectionMode(field);
                                    setActiveSearch(null);
                                    setResults([]);
                                }}
                                className="mt-2 mr-4 text-xs font-bold text-[#111111] underline"
                            >
                                📍 Choose on Map
                            </button>

                            {field === "pickup" && (
                                <button
                                    type="button"
                                    onClick={useCurrentPickup}
                                    className="mt-2 text-xs font-bold underline"
                                >
                                    Use my current location
                                </button>
                            )}

                            {activeSearch === field && searching && (
                                <p className="mt-2 text-xs">Searching locations...</p>
                            )}

                            {activeSearch === field && results.length > 0 && (
                                <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border">
                                    {results.map((place, index) => (
                                        <button
                                            key={place.place_id || index}
                                            type="button"
                                            onClick={() => choosePlace(place)}
                                            className="block w-full border-b p-3 text-left text-sm"
                                        >
                                            {place.display_name || place.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    {bookingStep === 1 && (
                        <button
                            type="button"
                            disabled={!pickup || !destination}
                            onClick={() => setBookingStep(2)}
                            className="w-full rounded-2xl bg-[#C1F11D] p-4 font-extrabold disabled:opacity-40"
                        >
                            Continue to Parcel Details →
                        </button>
                    )}

                    <div
                        className={`rounded-2xl bg-white p-4 space-y-4 ${bookingStep === 1 ? "hidden" : ""
                            }`}
                    >
                        <h2 className="font-extrabold">Sender Details</h2>
                        {["name", "phone"].map((field) => (
                            <input
                                key={field}
                                type={field === "phone" ? "tel" : "text"}
                                required
                                value={sender[field]}
                                onChange={(e) => setSender({
                                    ...sender,
                                    [field]: e.target.value,
                                })}
                                placeholder={`Sender ${field}`}
                                className="w-full rounded-xl bg-[#F4F5F7] p-3"
                            />
                        ))}

                        <h2 className="font-extrabold">Receiver Details</h2>
                        {["name", "phone"].map((field) => (
                            <input
                                key={field}
                                type={field === "phone" ? "tel" : "text"}
                                required
                                value={receiver[field]}
                                onChange={(e) => setReceiver({
                                    ...receiver,
                                    [field]: e.target.value,
                                })}
                                placeholder={`Receiver ${field}`}
                                className="w-full rounded-xl bg-[#F4F5F7] p-3"
                            />
                        ))}
                    </div>

                    {bookingStep === 2 && (
                        <div className="rounded-2xl bg-white p-4 space-y-4">
                            <h2 className="font-extrabold">Parcel Details</h2>

                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full rounded-xl bg-[#F4F5F7] p-3"
                            >
                                {["DOCUMENTS", "FOOD", "CLOTHES", "ELECTRONICS", "OTHER"].map((item) => (
                                    <option key={item} value={item}>{item}</option>
                                ))}
                            </select>

                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Parcel description"
                                maxLength={500}
                                className="w-full rounded-xl bg-[#F4F5F7] p-3"
                            />

                            <div className="grid grid-cols-2 gap-3">
                                <label className="text-sm font-semibold">
                                    Weight (kg)
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        required
                                        value={weightKg}
                                        onChange={(e) => setWeightKg(e.target.value)}
                                        className="mt-2 w-full rounded-xl bg-[#F4F5F7] p-3"
                                    />
                                </label>

                                <label className="text-sm font-semibold">
                                    Quantity
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        required
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        className="mt-2 w-full rounded-xl bg-[#F4F5F7] p-3"
                                    />
                                </label>
                            </div>
                        </div>

                    )}
                    {bookingStep === 2 && (
                        <div className="rounded-2xl bg-white p-4 space-y-4">
                            <h2 className="font-extrabold">Delivery & Payment</h2>

                            <label className="block text-sm font-semibold">
                                Delivery Vehicle
                                <select
                                    value={vehicleType}
                                    onChange={(e) => setVehicleType(e.target.value)}
                                    className="mt-2 w-full rounded-xl bg-[#F4F5F7] p-3"
                                >
                                    <option value="BIKE">Motorcycle</option>
                                    <option value="RICKSHAW">Rickshaw</option>
                                    <option value="CAR_NON_AC">Car Non-AC</option>
                                    <option value="CAR_AC">Car AC</option>
                                </select>
                            </label>

                            <label className="block text-sm font-semibold">
                                Your Delivery Fare (PKR)
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    required
                                    value={requestedPrice}
                                    onChange={(e) => setRequestedPrice(e.target.value)}
                                    placeholder="Enter your offer"
                                    className="mt-2 w-full rounded-xl bg-[#F4F5F7] p-3"
                                />
                            </label>

                            <label className="block text-sm font-semibold">
                                Who Will Pay?
                                <select
                                    value={paymentBy}
                                    onChange={(e) => setPaymentBy(e.target.value)}
                                    className="mt-2 w-full rounded-xl bg-[#F4F5F7] p-3"
                                >
                                    <option value="SENDER">Sender Pays</option>
                                    <option value="RECEIVER">Receiver Pays</option>
                                </select>
                            </label>

                            <textarea
                                value={instructions}
                                onChange={(e) => setInstructions(e.target.value)}
                                placeholder="Delivery instructions (optional)"
                                maxLength={500}
                                className="w-full rounded-xl bg-[#F4F5F7] p-3"
                            />
                        </div>
                    )}

                    {error && (
                        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                            {error}
                        </p>
                    )}

                    {bookingStep === 2 && (
                        <div className="space-y-3">
                            <button
                                type="button"
                                onClick={() => setBookingStep(1)}
                                className="w-full rounded-2xl bg-white p-4 font-bold"
                            >
                                ← Change Locations
                            </button>

                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full rounded-2xl bg-[#C1F11D] p-4 font-extrabold disabled:opacity-50"
                            >
                                {submitting ? "Booking..." : "Request Parcel Delivery"}
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </main>
    );
}