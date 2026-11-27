import { launch } from "./composition.js";
import { readJson } from "./data/read.js";
async function boot() {
    const settings = await readJson("settings.json");
    const query = new URLSearchParams(location.search), tol = query.get("tol");
    window.tracerState = await launch(settings, {
        letter: query.get("letter"),
        activity: query.get("mode") === "fill" ? "fill" : "trace",
        tolerance: tol === "gentle" || tol === "normal" || tol === "careful" ? tol : settings.tolerance
    });
}
void boot().catch(error => {
    const tip = document.getElementById("tip");
    tip.textContent = String(error);
    tip.classList.add("show");
    document.getElementById("live").textContent = tip.textContent;
});
