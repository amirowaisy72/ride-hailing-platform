"use client";

// Shared profile-photo display for the admin lists.
//
// ProfileAvatar: the row thumbnail. Shows the photo when one exists
// (click opens the fullscreen viewer); otherwise an initial letter.
// ProfilePhotoViewer: the fullscreen overlay. It is styled dark
// explicitly (black overlay, white text) instead of relying on the
// .admin-dark wrapper, so it stays dark wherever it is rendered.
//
// Photo sources (backend, additive fields):
//   passengers -> User.profileImage
//   drivers    -> latest PROFILE_PHOTO document imageUrl, else
//                 User.profileImage

import { useEffect } from "react";

export function ProfileAvatar({ url, name, size = 48, onOpen }) {
    const initial = (name || "?").trim().charAt(0).toUpperCase();
    if (!url) {
        return (
            <div
                aria-hidden="true"
                style={{ height: size, width: size, fontSize: size * 0.38 }}
                className="flex shrink-0 items-center justify-center rounded-2xl bg-[#1e4638] font-extrabold text-[#7fd4a8]"
            >
                {initial}
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={() => onOpen({ url, name })}
            title={`${name} — click for full photo`}
            aria-label={`View ${name} profile photo`}
            className="shrink-0 overflow-hidden rounded-2xl border border-white/10 transition hover:opacity-85"
        >
            <img
                src={url}
                alt=""
                loading="lazy"
                style={{ height: size, width: size }}
                className="object-cover"
            />
        </button>
    );
}

export default function ProfilePhotoViewer({ photo, onClose }) {
    useEffect(() => {
        if (!photo) return;
        function onKeyDown(event) {
            if (event.key === "Escape") onClose();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [photo, onClose]);

    if (!photo) return null;

    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`${photo.name} profile photo`}
            onClick={onClose}
        >
            <div
                className="relative max-h-full max-w-full"
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    src={photo.url}
                    alt={`${photo.name} profile photo`}
                    className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
                />
                <p className="mt-3 text-center text-sm font-bold text-white">
                    {photo.name}
                </p>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close photo"
                    className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#087F5B] text-xl font-bold text-white"
                >
                    ×
                </button>
            </div>
        </div>
    );
}
