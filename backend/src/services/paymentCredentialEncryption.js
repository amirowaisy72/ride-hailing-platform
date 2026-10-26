const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey() {
    const value = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;

    if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
        throw new Error(
            "PAYMENT_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex key"
        );
    }

    return Buffer.from(value, "hex");
}

function encryptCredentials(credentials) {
    if (
        !credentials ||
        typeof credentials !== "object" ||
        Array.isArray(credentials)
    ) {
        throw new Error("Valid payment credentials are required");
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        ALGORITHM,
        getEncryptionKey(),
        iv
    );

    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);

    return [
        "v1",
        iv.toString("hex"),
        cipher.getAuthTag().toString("hex"),
        encrypted.toString("hex"),
    ].join(":");
}

function decryptCredentials(payload) {
    if (typeof payload !== "string") {
        throw new Error("Invalid encrypted credentials");
    }

    const parts = payload.split(":");

    if (
        parts.length !== 4 ||
        parts[0] !== "v1" ||
        !/^[a-f0-9]{24}$/i.test(parts[1]) ||
        !/^[a-f0-9]{32}$/i.test(parts[2]) ||
        !/^(?:[a-f0-9]{2})+$/i.test(parts[3])
    ) {
        throw new Error("Invalid encrypted credentials format");
    }

    const [, ivHex, tagHex, encryptedHex] = parts;
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        getEncryptionKey(),
        Buffer.from(ivHex, "hex")
    );

    decipher.setAuthTag(Buffer.from(tagHex, "hex"));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, "hex")),
        decipher.final(),
    ]).toString("utf8");

    const credentials = JSON.parse(decrypted);

    if (
        !credentials ||
        typeof credentials !== "object" ||
        Array.isArray(credentials)
    ) {
        throw new Error("Invalid payment credentials payload");
    }

    return credentials;
}

module.exports = {
    encryptCredentials,
    decryptCredentials,
};