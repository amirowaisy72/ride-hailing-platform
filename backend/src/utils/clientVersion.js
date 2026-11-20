// Backward-compatibility gate for new-version-only enforcement.
//
// The live app (1.0.7 and earlier) sends NO version header, so a
// missing/invalid header MUST mean "old client": old behaviour,
// never a rejection. Only a client that identifies itself with
// X-App-Version-Code >= ENFORCED_FROM_VERSION_CODE gets the stricter
// rules (mandatory Pakistani mobile, etc.). New fields stay optional
// on the wire for everyone; enforcement is version-gated, never a
// new required field.
const ENFORCED_FROM_VERSION_CODE = 10; // first release after 1.0.7 (code 9)

function getClientVersionCode(req) {
    const code = Number(req.headers?.["x-app-version-code"]);
    return Number.isInteger(code) && code > 0 ? code : null;
}

// True only for clients that positively identify as the new version
// or later. Old clients (no header) return false.
function isNewClient(req) {
    const code = getClientVersionCode(req);
    return code !== null && code >= ENFORCED_FROM_VERSION_CODE;
}

module.exports = { ENFORCED_FROM_VERSION_CODE, getClientVersionCode, isNewClient };
