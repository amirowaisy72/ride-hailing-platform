"use client";

import AuthGuard from "@/components/AuthGuard";
import EditProfileScreen from "@/components/EditProfileScreen";

export default function PassengerProfilePage() {
    return (
        <AuthGuard role="PASSENGER">
            <EditProfileScreen role="PASSENGER" />
        </AuthGuard>
    );
}
