export async function readJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok)
        throw new Error(`${response.status} ${url}`);
    return response.json();
}
export function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
