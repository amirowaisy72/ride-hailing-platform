import { notFound } from "next/navigation";
import MapDemo from "./MapDemo";

export const metadata = { title: "Driver map demo" };

export default function DriverMapDemoPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <MapDemo />;
}
