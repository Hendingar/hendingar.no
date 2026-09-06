/**
 * Landing page copy.
 *
 * Separated from layout so a typo fix doesn't mean touching layout code, and so each string has a
 * named slot instead of being `array[1]` of an anonymous tuple.
 *
 * The five checks used to be ordered here too. They are not landing copy — `/send-inn` states the
 * same five before you submit and the verdict panel prints them afterwards — so they moved to
 * `lib/checks.ts`, next to the component that renders them.
 */

export const MANIFEST: readonly string[] = [
	'Gratis for alltid',
	'Ingen reklame',
	'Data blir i Europa'
];
