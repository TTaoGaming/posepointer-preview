export function mountWebAwesome(config, sceneRef, settings, definitions, preparedFor) {
  const root = document.querySelector('#controls');
  for (const [name, value] of Object.entries(config.theme)) document.body.style.setProperty(`--ui-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
  const controls = new Map();
  const icon = name => {
    const part = document.createElement('wa-icon');
    part.slot = 'start';
    part.setAttribute('src', config.iconRoot + config.icons[name] + config.iconSuffix);
    part.className = 'stock-icon';
    return part;
  };
  const button = (id, label, iconName) => {
    const part = document.createElement('wa-button');
    part.dataset.control = id;
    part.appearance = 'filled';
    part.variant = 'neutral';
    part.textContent = label;
    if (iconName) part.prepend(icon(iconName));
    const row = id === 'start' ? document.querySelector('#start-row') : id === 'gear' ? document.querySelector('#gear-row') : document.querySelector('#action-row');
    row.append(part);
    controls.set(id, part);
    return part;
  };
  const title = document.querySelector('#view-title');
  const status = document.querySelector('#view-status');
  const logo = document.querySelector('#logo-card');
  document.querySelector('#logo-prepared').textContent = preparedFor ? `${config.labels.prepared} ${preparedFor}` : '';
  document.querySelector('#logo-made').textContent = config.labels.made;
  title.textContent = config.labels.title;
  button('start', config.labels.start, 'start');
  button('back', config.labels.back, 'back');
  button('again', config.labels.again, 'again');
  button('next', config.labels.next, 'next');
  const gear = button('gear', '', 'gear');
  gear.setAttribute('aria-label', config.labels.settings);
  const panel = document.querySelector('#settings-panel');
  panel.querySelector('h2').textContent = config.labels.settings;
  const rows = panel.querySelector('.settings-rows');
  const syncSettings = scene => {
    rows.replaceChildren();
    for (const logical of scene.pbtns) {
      const definition = definitions.find(item => item.id === logical.setting);
      const part = document.createElement('wa-button');
      part.dataset.control = logical.id;
      part.textContent = logical.label || definition?.label || logical.id;
      if (logical.glyph && config.icons[logical.glyph]) part.prepend(icon(logical.glyph));
      rows.append(part);
    }
  };
  let lastPanelKey = '';
  function bindHitRegion(part, box) {
    const bounds = part.getBoundingClientRect();
    Object.assign(box, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, w: bounds.width, h: bounds.height });
  }
  function sync() {
    const scene = sceneRef();
    if (!scene) return;
    document.querySelector('#start-flow').hidden = scene.started || scene.panelOpen;
    document.querySelector('#letter-flow').hidden = !scene.started || scene.panelOpen;
    const gearPart = controls.get('gear');
    const gearHost = document.querySelector(scene.started ? '#letter-head' : '#gear-row');
    if (gearPart?.parentElement !== gearHost) gearHost.append(gearPart);
    const item = window.__core?.getItem?.();
    if (scene.started) {
      const board = document.querySelector('#board-row').getBoundingClientRect();
      const inset = config.layout.boardInset;
      const available = { width: board.width, height: board.height - inset - inset };
      const aspect = item?.aspect;
      const height = Math.min(available.height, available.width / aspect);
      const width = height * aspect;
      scene.frame = {
        left: board.x + (available.width - width) / 2,
        top: board.y + inset + (available.height - height) / 2,
        width,
        height
      };
    }
    const visible = new Set(scene.activeButtons().map(item => item.id));
    for (const [id, part] of controls) {
      const logical = scene.activeButtons().find(item => item.id === id);
      part.hidden = !visible.has(id) || scene.panelOpen;
      if (logical) { bindHitRegion(part, logical); part.style.setProperty('--hold-progress', logical.fill); }
    }
    title.hidden = scene.started || scene.panelOpen;
    logo.hidden = scene.started || scene.panelOpen;
    status.hidden = !scene.started || scene.panelOpen;
    const character = item?.id?.split('-').at(-1) || '';
    status.textContent = !scene.signal ? config.labels.hand : scene.statusMode === 'done' ? `${config.labels.success} ${character}` : `${config.labels.trace} ${character}`;
    panel.hidden = !scene.panelOpen;
    gear.hidden = scene.panelOpen;
    if (scene.panelOpen) {
      const key = `${scene.panelPage}:${scene.pbtns.map(item => item.id).join()}`;
      if (key !== lastPanelKey) { lastPanelKey = key; syncSettings(scene); }
    }
  }
  addEventListener('tracer-view-sync', sync);
  addEventListener('resize', sync);
  return { sync };
}
