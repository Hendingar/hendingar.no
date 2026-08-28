/**
 * Landing page copy.
 *
 * Separated from layout so a typo fix doesn't mean touching layout code, and so each string has a
 * named slot instead of being `array[1]` of an anonymous tuple.
 *
 * `DOES_NOT` is the prose rendering of README.md#what-it-does-not-do and `PIPELINE` of the
 * README's verification table. Those are duplicated facts today. When the moderation queue lands,
 * PIPELINE should move to @hendingar/core and be rendered from there — the stage names will key
 * agent output and event statuses, which makes them domain data, not copy.
 */

export type Claim = { readonly term: string; readonly body: string };
export type PipelineStep = { readonly name: string; readonly what: string };

export const MANIFEST: readonly string[] = [
	'Gratis for alltid',
	'Ingen reklame',
	'Data blir i Europa'
];

export const DOES: readonly string[] = [
	'Éi søkbar, geotagga liste i staden for tolv silo-ar.',
	'Kven som helst kan leggje inn ei hending. Ingen konto.',
	'Kart, så du ser kva som skjer nær deg.',
	'RSS og iCal per stad — kalenderen din er ein førsteklasses klient.',
	'Data i EU. GDPR ved arkitektur, ikkje ved personvernerklæring.'
];

export const DOES_NOT: readonly Claim[] = [
	{ term: 'Billettar', body: 'Ingen kasse, ingen gebyr. Lenkje til der billettane faktisk finst.' },
	{
		term: 'Sosialt nettverk',
		body: 'Ingen følgjarar, ingen feed, ingen varsel som dreg deg tilbake.'
	},
	{ term: 'Reklame', body: 'Ingen annonsar, ingen sporing, ingen datasal. Aldri.' },
	{ term: 'Innhegning', body: 'Konto er frivillig. Alt kan eksporterast. Å gå er lett med vilje.' }
];

export const PIPELINE: readonly PipelineStep[] = [
	{ name: 'Truverd', what: 'Er dette ei verkeleg hending, eller spam?' },
	{ name: 'Duplikat', what: 'Same hending frå to kjelder blir éi.' },
	{ name: 'Normalisering', what: 'Dato, tid og gjentaking blir struktur.' },
	{ name: 'Geokoding', what: 'Frå stadnamn til koordinat — eller flagg.' },
	{ name: 'Kategori', what: 'Konsert, teater, kulturhus, sport …' },
	{ name: 'Kjelde', what: 'Finst hendinga der ho seier ho kjem frå?' }
];
