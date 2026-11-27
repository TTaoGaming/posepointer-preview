import { isPack, readJson } from './load.js';
export function pointList(url) {
    return { async load() {
            const pack = await readJson(url);
            if (!isPack(pack))
                throw new TypeError(url);
            return pack;
        } };
}
