import PassengerOfferAlerts from "@/components/PassengerOfferAlerts";

// Passenger section layout (new in Phase 2, Amir A7 extension): renders
// every passenger screen plus the offer-arrival pill, so a driver bid on
// a Buy & Deliver / parcel request surfaces even when the passenger is
// not on the home page (whose Active requests strip already covers it —
// the pill suppresses itself there and on order details pages).
export default function PassengerLayout({ children }) {
  return (
    <>
      {children}
      <PassengerOfferAlerts />
    </>
  );
}
