// Playback order and recorded-clip fallback from old/lessons.js. A new
// selection invalidates pending continuations of the previous lesson.
export function createVoice(settings, lessons, clips) {
    const config = settings.audio, speech = window.speechSynthesis;
    speech?.getVoices();
    let enabled = true, generation = 0, current;
    let timer;
    function stop() {
        generation++;
        clearTimeout(timer);
        speech?.cancel();
        current?.pause();
        current = undefined;
    }
    function play(key, praise) {
        if (!enabled)
            return;
        stop();
        const lesson = lessons[key.toLowerCase()], token = generation;
        const parts = [];
        if (praise)
            parts.push(["praise", praise]);
        if (lesson) {
            const lower = key.toLowerCase();
            parts.push([lower + "-name", lesson[0]], [lower + "-sound", lesson[1]], [lower + "-word", lesson[2]]);
        }
        function part(index) {
            if (token !== generation || index === parts.length)
                return;
            const [id, text] = parts[index];
            let ended = false;
            function next() {
                if (ended || token !== generation)
                    return;
                ended = true;
                clearTimeout(timer);
                timer = setTimeout(() => part(index + 1), config.gapMs);
            }
            function speak() {
                if (token !== generation || ended)
                    return;
                if (!speech || !window.SpeechSynthesisUtterance)
                    return next();
                const local = speech.getVoices().filter(voice => voice.localService);
                const voice = local.find(voice => voice.lang === config.language) ?? local.find(voice => voice.default) ?? local[0];
                if (!voice)
                    return next();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.voice = voice;
                utterance.rate = config.rate;
                utterance.pitch = config.pitch;
                utterance.lang = config.language;
                utterance.onend = next;
                utterance.onerror = next;
                timer = setTimeout(next, config.timeoutMs + text.length * config.msPerChar);
                speech.speak(utterance);
            }
            if (!clips[id])
                return speak();
            const clip = new Audio(settings.sources.audioBase + clips[id]);
            current = clip;
            let failed = false;
            function fallback() { if (!failed) {
                failed = true;
                speak();
            } }
            clip.onended = next;
            clip.onerror = fallback;
            clip.play().catch(fallback);
        }
        part(0);
    }
    return {
        play,
        toggle() { enabled = !enabled; if (!enabled)
            stop(); return enabled; }
    };
}
