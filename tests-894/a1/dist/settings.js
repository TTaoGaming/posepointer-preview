export function format(template, values) {
    return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}
