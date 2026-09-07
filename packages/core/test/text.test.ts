import { describe, expect, it } from 'vitest';
import { decodeEntities, plainText } from '../src/text.ts';

/**
 * These began as `htmlToText` inside importers/dnt, the one importer that had noticed its source
 * ships editor HTML. They are here because every source has that problem, and because when it is
 * not fixed the markup escapes into the meta description, the JSON-LD and the .ics at once.
 */
describe('plainText', () => {
	it('keeps paragraph structure instead of running the text together', () => {
		expect(plainText('<p>Frå Fitjar Bedehus</p><p>Turen går på merka sti</p>')).toBe(
			'Frå Fitjar Bedehus\n\nTuren går på merka sti'
		);
	});

	it('decodes the entities our sources actually emit', () => {
		expect(plainText('<p>KOM DEG UT&nbsp;-dagen</p>')).toBe('KOM DEG UT -dagen');
		expect(plainText('<p>&#229;pen &amp; fin</p>')).toBe('åpen & fin');
	});

	it('decodes the guillemets, which are Norwegian’s own quotation marks', () => {
		/*
		 * Live on the site: a Moster Amfi concert published as
		 * `Viser, Historie og Humor &laquo;Frå Vestlandet til Amerika i 200 år&raquo;` — in the
		 * `<h1>`, in the JSON-LD `name`, in the `.ics`, and in the slug as `-laquo-…-raquo`.
		 *
		 * The named table is a list while the numeric branch is generic, so a missing entry fails
		 * silently and reads as the source's own text. These two are not an exotic character here.
		 */
		expect(plainText('Humor &laquo;Frå Vestlandet til Amerika&raquo;')).toBe(
			'Humor «Frå Vestlandet til Amerika»'
		);
	});

	it('turns a line break into a line, not a space', () => {
		expect(plainText('<p>søndag<br>kl. 11</p>')).toBe('søndag\nkl. 11');
	});

	it('strips markup that arrived entity-encoded', () => {
		/*
		 * The live bug. sunnhordland.museum.no's payload carries `<strong>` inside a JSON string, so
		 * the page rendered `&lt;strong&gt;Med historia om den siste heksebrenninga…` as its meta
		 * description — which is what Google would have shown as the snippet. Stripping before
		 * decoding leaves it; decoding before stripping would eat a reader's literal "<". So both,
		 * in that order.
		 */
		expect(plainText('&lt;strong&gt;Med historia&lt;/strong&gt; om heksebrenninga')).toBe(
			'Med historia om heksebrenninga'
		);
	});

	it('leaves arithmetic alone', () => {
		// `<[^>]+>` eats "< 5 >" here and takes half the sentence with it.
		expect(plainText('plass til 3 < 5 born')).toBe('plass til 3 < 5 born');
	});

	it('is idempotent, because it runs at import AND at render', () => {
		const once = plainText('<p>Ein</p><p>To</p>');
		expect(plainText(once)).toBe(once);
	});

	it('returns null rather than an empty string for markup with no words', () => {
		expect(plainText('<p></p>')).toBeNull();
		expect(plainText('   ')).toBeNull();
		expect(plainText(null)).toBeNull();
		expect(plainText(undefined)).toBeNull();
	});

	it('drops a script tag with its contents, not just its tags', () => {
		expect(plainText('<p>Konsert</p><script>alert(1)</script>')).toBe('Konsert');
	});

	it('keeps list items readable', () => {
		expect(plainText('<ul><li>Ein</li><li>To</li></ul>')).toBe('• Ein\n\n• To');
	});
});

/**
 * `decodeEntities` was private here and reimplemented in five importers, whose tables had drifted
 * apart — none of them carried `laquo`/`raquo`, which is how a Moster Amfi concert reached the live
 * site as `…Humor &laquo;Frå Vestlandet…&raquo;`. These assertions moved here from
 * `importers/tec/test/map.test.ts` when the five copies were deleted, because a shared function is
 * tested where it lives.
 */
describe('decodeEntities', () => {
	it('decodes numeric and named references alike', () => {
		expect(decodeEntities('B&#248;mlo &amp; Stord &#8211; &#x2019;25')).toBe('Bømlo & Stord – ’25');
	});

	it('leaves something that is not an entity alone', () => {
		expect(decodeEntities('5 & 10 < 20')).toBe('5 & 10 < 20');
	});

	it('decodes every named entity the deleted importer tables carried between them', () => {
		/*
		 * The union of five drifted tables: allevents/bakhagen/riksteatret had the Norwegian letters
		 * and the dashes, tec had the curly quotes and the ellipsis but NOT ø/å/æ, kyrkja had neither
		 * the dashes nor the quotes. One table has to cover all of it or removing them lost ground.
		 */
		expect(decodeEntities('&oslash;&Oslash;&aring;&Aring;&aelig;&AElig;')).toBe('øØåÅæÆ');
		expect(decodeEntities('&ndash;&mdash;&hellip;')).toBe('–—…');
		expect(decodeEntities('&lsquo;&rsquo;&ldquo;&rdquo;')).toBe('‘’“”');
		expect(decodeEntities('&laquo;Frå Vestlandet&raquo;')).toBe('«Frå Vestlandet»');
	});

	it('refuses a codepoint above the Unicode maximum instead of throwing', () => {
		/*
		 * Not defensive noise. `String.fromCodePoint` throws a RangeError above 0x10FFFF, and
		 * `plainText` runs at render time — in app/src/lib/jsonld.ts, in the .ics route and on the
		 * event page — so without the bound a description containing `&#1114112;` is an SSR crash
		 * reachable from text a stranger typed into somebody's calendar. Every importer copy had this
		 * guard; the copy in core did not.
		 */
		expect(() => decodeEntities('&#1114112;')).not.toThrow();
		expect(decodeEntities('&#1114112;')).toBe('&#1114112;');
		expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
		// The boundary itself still decodes.
		expect(decodeEntities('&#x10FFFF;')).toBe(String.fromCodePoint(0x10ffff));
	});
});
