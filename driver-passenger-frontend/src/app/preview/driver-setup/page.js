import { notFound } from "next/navigation";
import DriverSetupDemo from "@/components/driver/setup/DriverSetupDemo";

export default function DriverSetupPreviewPage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <DriverSetupDemo />;
}
