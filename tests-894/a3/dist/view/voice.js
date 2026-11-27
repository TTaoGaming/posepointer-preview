// Name, phonics and word playback from old/lessons.js (MIT). Use device-local voices.
import { readJson, record } from '../data/load.js';
function playlist(key, lesson) {
    const [name, sound, word] = lesson;
    return [{ key: key + '-name', say: name }, { key: key + '-sound', say: sound }, { key: key + '-word', say: word }];
}
export async function createVoice(settings, unavailable) {
    const { voice, files } = settings;
    const [lessonData, manifest] = await Promise.all([readJson(files.lessons), readJson(files.audioManifest)]);
    if (!record(lessonData) || !record(manifest))
        throw new TypeError(files.lessons);
    const lessons = lessonData;
    const speech = window.speechSynthesis;
    speech?.getVoices(); // Let the browser populate its local voice list before the first press.
    let enabled = true, token = 0, audio = null;
    let finishPending;
    function stop() {
        token++;
        finishPending?.();
        finishPending = undefined;
        speech?.cancel();
        audio?.pause();
        audio = null;
    }
    function speak(text) {
        const candidates = speech?.getVoices().filter(v => v.localService);
        const selected = candidates?.find(v => v.lang === voice.language) ??
            candidates?.find(v => v.lang.split('-')[0] === voice.language.split('-')[0]);
        if (!selected)
            return Promise.resolve(false);
        return new Promise(resolve => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = selected;
            utterance.lang = voice.language;
            utterance.rate = voice.rate;
            utterance.pitch = voice.pitch;
            const timeout = window.setTimeout(() => finish(true), voice.timeout + text.length * voice.perChar);
            function finish(ok) {
                clearTimeout(timeout);
                utterance.onend = utterance.onerror = null;
                finishPending = undefined;
                resolve(ok);
            }
            finishPending = () => finish(false);
            utterance.onend = () => finish(true);
            utterance.onerror = () => finish(false);
            speech.speak(utterance);
        });
    }
    async function clip(file) {
        const src = new URL(file, new URL(files.audioManifest, document.baseURI));
        if (src.origin !== location.origin)
            return false;
        const current = audio = new Audio(src.href);
        return new Promise(resolve => {
            let settled = false;
            const finish = (ok) => {
                if (settled)
                    return;
                settled = true;
                finishPending = undefined;
                resolve(ok);
            };
            finishPending = () => finish(false);
            current.onended = () => finish(true);
            current.onerror = () => finish(false);
            current.play().catch(() => finish(false));
        });
    }
    function info(key) {
        const data = lessons[key.toLowerCase()];
        if (Array.isArray(data) && data.every((p) => typeof p === 'string'))
            return data;
    }
    return {
        info, stop, get enabled() { return enabled; },
        toggle() { enabled = !enabled; if (!enabled)
            stop(); },
        async play(key, praise = false, reportUnavailable = false) {
            stop();
            if (!enabled)
                return;
            const mine = token, lesson = info(key);
            const list = lesson ? playlist(key.toLowerCase(), lesson) : [];
            if (praise)
                list.unshift({ key: 'praise', say: settings.labels.praise });
            for (const part of list) {
                if (mine !== token)
                    return;
                const file = manifest[part.key];
                const played = typeof file === 'string' && await clip(file);
                if (mine !== token)
                    return;
                if (!played && !await speak(part.say)) {
                    if (reportUnavailable && mine === token)
                        unavailable();
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, voice.pause));
            }
        }
    };
}
