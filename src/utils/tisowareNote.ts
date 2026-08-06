/**
 * CuraFlow — Tisoware Note Utilities
 *
 * Helpers for reading Tisoware import metadata out of a shift entry's note
 * field. The Tisoware import writes a "[TISO:CODE] description" prefix into
 * the note for every absence it confirms (see `mapLoanrToPosition` in
 * `server/utils/tisowareImport.ts`), e.g. "[TISO:530] Krank ohne
 * AU-Bescheinigung". These helpers let the UI show the human-readable
 * Tisoware reason as a hover tooltip.
 */

/**
 * Extracts the Tisoware absence description from a shift note, or null when
 * the note carries no Tisoware marker or no description text.
 *
 * The description is the human-readable text the Tisoware import appends
 * after the "[TISO:CODE]" prefix (e.g. "Krank ohne AU-Bescheinigung" for
 * "[TISO:530] Krank ohne AU-Bescheinigung"). Notes without a marker (local
 * CuraFlow entries) and markers without a description (bare "[TISO:900]")
 * both return null so callers can fall back to their default label.
 *
 * @param note - The shift entry note (may be null/undefined).
 * @returns The Tisoware description, or null when not present.
 */
export function getTisowareDescription(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const match = note.match(/\[TISO:[^\]]+\](?:\s+(.*))?/);
  if (!match) return null;
  const description = match[1]?.trim();
  return description ? description : null;
}
