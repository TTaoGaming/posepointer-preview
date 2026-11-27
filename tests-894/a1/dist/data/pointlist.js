import { isRecord, readJson } from "./read.js";
function point(value) {
    return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}
function glyph(value) {
    return Array.isArray(value) && value.length > 0 && value.every(path => Array.isArray(path) && path.length >= 2 && path.every(point));
}
export function pointlist(url) {
    return { async load() {
            const data = await readJson(url);
            if (!isRecord(data) || !Object.keys(data).length)
                throw new TypeError(url);
            return Object.fromEntries(Object.entries(data).map(([key, strokes]) => {
                if (!glyph(strokes))
                    throw new TypeError(`${url} [${key}]`);
                return [key, strokes];
            }));
        } };
}
