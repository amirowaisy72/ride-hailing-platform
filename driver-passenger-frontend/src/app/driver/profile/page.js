"use client";

import AuthGuard from "@/components/AuthGuard";
import EditProfileScreen from "@/components/EditProfileScreen";

export default function DriverProfilePage() {
    return (
        <AuthGuard role="DRIVER">
            <EditProfileScreen role="DRIVER" />
        </AuthGuard>
    );
}