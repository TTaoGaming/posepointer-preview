// Copyright Tao. All rights reserved.
const banner = document.getElementById('preview-notice');

try {
  const response = await fetch(new URL('../preview-notice.txt', import.meta.url));
  const type = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (response.ok && type !== 'text/html' && type !== 'application/xhtml+xml') {
    const text = Array.from((await response.text()).trim()).slice(0, 300).join('');
    if (text) {
      banner.textContent = text;
      banner.hidden = false;
    }
  }
} catch {
  // A preview notice is optional.
}
