const API_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export async function apiRequest(path, options = {}) {
    const { token, headers, ...requestOptions } = options;

    const send = async (accessToken) => {
        const response = await fetch(`${API_URL}${path}`, {
            ...requestOptions,
            headers: {
                ...(requestOptions.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(accessToken
                    ? { Authorization: `Bearer ${accessToken}` }
                    : {}),
                ...headers,
            },
        });

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
        throw new Error(data.message || `Request failed: ${response.status}`);
    }

    return data;
}
