import { readJson } from './data/load.js';
import { compose } from './composition.js';
import { preset } from './settings.js';
try {
    const settings = await readJson('settings.json');
    await compose(settings, preset(new URLSearchParams(location.search).get('tol'), settings.initial.tolerance));
}
catch (error) {
    const message = String(error);
    document.getElementById('live').textContent = message;
    const tip = document.getElementById('tip');
    tip.textContent = message;
    tip.classList.add('show');
    throw error;
}
