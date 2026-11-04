import { notFound } from "next/navigation";
import RideFlowDemo from "./RideFlowDemo";

export const metadata = { title: "Driver ride flow demo" };

export default function DriverRideDemoPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <RideFlowDemo />;
}
