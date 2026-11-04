import { notFound } from "next/navigation";
import ServicesDemo from "./ServicesDemo";

export const metadata = { title: "Driver services demo" };

export default function DriverServicesDemoPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <ServicesDemo />;
}
