export async function readJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`${response.status} ${url}`);
    return response.json();
}
export function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isPack(value) {
    if (!record(value) || !Object.keys(value).length)
        return false;
    return Object.values(value).every(glyph => Array.isArray(glyph) && glyph.length &&
        glyph.every(path => Array.isArray(path) && path.length > 1 &&
            path.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) &&
            path.some(p => p[0] !== path[0][0] || p[1] !== path[0][1])));
}
