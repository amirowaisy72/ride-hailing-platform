"use client";

import { useEffect } from "react";
import { installPhotoRestoreListener } from "@/lib/nativePhoto";

// Installs the `appRestoredResult` listener at app start so a photo
// picked just before the OS killed the app is not lost: the Camera
// plugin result is replayed after relaunch and handed to the pick
// screen that owns the slot (see src/lib/nativePhoto.js). Renders
// nothing.
export default function NativePhotoRestore() {
    useEffect(() => {
        void installPhotoRestoreListener();
    }, []);
    return null;
}
