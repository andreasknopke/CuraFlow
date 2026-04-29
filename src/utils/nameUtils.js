/**
 * Generiere ein Standardkürzel aus dem vollständigen Namen.
 * Wenn der Name aus mindestens zwei Wörtern besteht, werden die ersten Buchstaben des ersten und zweiten Wortes genommen.
 * Bei einem einzelnen Wort werden die ersten beiden Buchstaben verwendet.
 * @param {string} name Der vollständige Name (z.B. 'Max Mustermann')
 * @returns {string} Kürzel (z.B. 'MM')
 */
export function generateDefaultInitials(name) {
  if (!name || !name.trim()) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0].charAt(0);
    const last = parts[parts.length - 1].charAt(0);
    return (first + last).toUpperCase();
  }
  return name.trim().substring(0, 2).toUpperCase();
}

/**
 * Schlägt einen alternativen Namen vor, indem bei Namenskonflikt eine Nummer angehängt wird (z.B. 'Max Mustermann (2)').
 * @param {string} baseName Der ursprüngliche Name
 * @param {string[]} existingNames Liste aller bereits verwendeten Namen
 * @returns {string} Freier alternativer Name
 */
export function suggestAlternativeName(baseName, existingNames) {
  let count = 2;
  let suggestedName;
  do {
    suggestedName = `${baseName} (${count})`;
    count++;
  } while (existingNames.includes(suggestedName));
  return suggestedName;
}

/**
 * Schlägt ein eindeutiges Kürzel vor, basierend auf dem Basisnamen und bereits vergebenen Kürzeln.
 * Nimmt das Standardkürzel und hängt eine Zahl an, falls es bereits existiert.
 * @param {string} name Der vollständige Name
 * @param {string[]} existingInitials Liste aller bereits verwendeten Kürzel
 * @returns {string} Eindeutiges Kürzel
 */
export function suggestInitials(name, existingInitials) {
  const defaultInit = generateDefaultInitials(name);
  if (!defaultInit) return '';
  if (!existingInitials.includes(defaultInit)) return defaultInit;
  let count = 2;
  let candidate;
  do {
    candidate = defaultInit + count;
    count++;
  } while (existingInitials.includes(candidate));
  return candidate;
}
