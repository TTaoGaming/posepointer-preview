export function preset(value, fallback) {
    if (value === 'gentle' || value === 'careful' || value === 'normal')
        return value;
    if (fallback === 'gentle' || fallback === 'careful' || fallback === 'normal')
        return fallback;
    throw new RangeError(fallback);
}
