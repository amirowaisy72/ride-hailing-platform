const API_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export async function apiRequest(path, options = {}) {
    const { token, headers, ...requestOptions } = options;

    const send = async (accessToken) => {
        let response;

        try {
            response = await fetch(`${API_URL}${path}`, {
                ...requestOptions,
                signal: AbortSignal.timeout(45000),
                headers: {
                    ...(requestOptions.body && !(requestOptions.body instanceof FormData)
                        ? { "Content-Type": "application/json" }
                        : {}),
                    ...(accessToken
                        ? { Authorization: `Bearer ${accessToken}` }
                        : {}),
                    ...headers,
                },
            });
        } catch (error) {
            if (error.name === "TimeoutError" || error.name === "AbortError") {
                throw new Error(
                    `Server response timeout: ${path}. Please try again.`
                );
            }

            throw new Error(
                `Connection failed (${path}): ${error.message}`
            );
        }

        const data = await response.json().catch(() => ({}));
        return { response, data };
    };

    let { response, data } = await send(token);

    if (
        response.status === 401 &&
        token &&
        path !== "/auth/refresh" &&
        path !== "/auth/logout"
    ) {
        const { renewAccessToken } = await import("@/lib/tokenManager");
        const newToken = await renewAccessToken();

        ({ response, data } = await send(newToken));
    }

    if (!response.ok) {
        const error = new Error(
            data.message || `Request failed: ${response.status}`
        );
        // Keep the machine-readable contract (e.g. code "GPS_STALE" on a
        // 403) alongside the message, so callers can match the code first
        // and fall back to the message text on older servers.
        if (data.code) error.code = data.code;
        error.status = response.status;
        throw error;
    }

    return data;
}
