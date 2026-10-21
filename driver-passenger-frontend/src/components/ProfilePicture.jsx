
"use client";

import { useRef, useState } from "react";
import { Camera, LoaderCircle } from "lucide-react";
import { apiRequest } from "@/lib/api";

export default function ProfilePicture({ token, user, onUploaded }) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");
    const [imageUrl, setImageUrl] = useState(user?.profileImage || "");

    const picture = imageUrl || user?.profileImage;

    async function handleFile(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || uploading) return;

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
            file.size > 5 * 1024 * 1024) {
            setError("Select JPG, PNG or WebP under 5 MB.");
            return;
        }

        setError("");
        setUploading(true);

        try {
            const form = new FormData();
            form.append("picture", file);

            const result = await apiRequest("/account/me/picture", {
                method: "PATCH",
                token,
                body: form,
            });

            setImageUrl(result.profileImage);
            onUploaded?.(result.profileImage);
        } catch (err) {
            setError(err.message || "Upload failed");
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="shrink-0">
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFile}
                disabled={uploading}
            />
            <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                aria-label="Upload profile picture"
                className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-emerald-100 text-2xl font-bold text-[#087F5B] dark:bg-[#263D36]"
            >
                {picture ? (
                    <img src={picture} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                    (user?.firstName || "U").charAt(0).toUpperCase()
                )}
                <span className="absolute bottom-0 right-0 rounded-tl-lg bg-[#087F5B] p-1 text-white">
                    {uploading ? <LoaderCircle size={13} className="animate-spin" /> : <Camera size={13} />}
                </span>
            </button>
            {error && <p role="alert" className="mt-1 max-w-24 text-[10px] text-red-500">{error}</p>}
        </div>
    );
}
