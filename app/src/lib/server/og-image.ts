import { read } from '$app/server';
import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import archivoRegular from '@fontsource/archivo/files/archivo-latin-400-normal.woff?url';
import archivoBold from '@fontsource/archivo/files/archivo-latin-700-normal.woff?url';
import spaceMono from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff?url';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm?url';

/**
 * The picture a shared link shows.
 *
 * ADR 0011 already names the shape of our traffic: "that person almost always arrives from a
 * shared link, once, on a phone". Until now such a link arrived as bare text. `og:image` was set
 * only when an event carried a poster, and the poster the main source hands us is
 * `imageRightsVerified: false` — so in practice most shares had no picture at all, which in a
 * Facebook group is the difference between a card and a line of grey.
 *
 * So we draw one. Same duotone as the site (docs/brand.md), same typeface, 1200x630 — the size
 * every scraper crops toward.
 *
 * ## Why not just hotlink the poster
 *
 * Where the rights ARE verified we do use it, but by fetching the bytes here with a hard deadline
 * rather than naming the source's CDN in `og:image`. A scraper that cannot fetch our image shows
 * nothing, and a third party's uptime is not something to put on that path. The generated card is
 * always the fallback, never an error.
 */

const WIDTH = 1200;
const HEIGHT = 630;

/** Brand tokens, copied deliberately: satori has no cascade to read `brand.css` through. */
const NAVY = '#1e2c4a';
const NAVY_DEEP = '#16223b';
const PEACH = '#f7a98a';
const PEACH_DIM = 'rgba(247, 169, 138, 0.82)';

/**
 * satori takes React elements. There is no React here and no JSX in a `.ts` file, so this builds
 * the same shape by hand — a React element is `{ type, props, key }` and nothing more.
 */
type Element = {
	type: string;
	props: Record<string, unknown> & { children?: Element | Element[] | string };
	key: null;
};

function h(
	type: string,
	props: Record<string, unknown>,
	children?: Element | Element[] | string
): Element {
	return { type, props: { ...props, children }, key: null };
}

let fonts: Awaited<ReturnType<typeof loadFonts>> | null = null;
let wasmReady: Promise<void> | null = null;

async function loadFonts() {
	const [regular, bold, mono] = await Promise.all([
		read(archivoRegular).arrayBuffer(),
		read(archivoBold).arrayBuffer(),
		read(spaceMono).arrayBuffer()
	]);
	return [
		{ name: 'Archivo', data: regular, weight: 400 as const, style: 'normal' as const },
		{ name: 'Archivo', data: bold, weight: 700 as const, style: 'normal' as const },
		{ name: 'Space Mono', data: mono, weight: 400 as const, style: 'normal' as const }
	];
}

/**
 * Both the fonts and the rasteriser are loaded once per process and reused.
 *
 * `initWasm` throws if it is called twice, so the promise is the latch rather than a boolean — two
 * requests arriving together must not both get past a flag that neither has set yet.
 */
async function ready() {
	if (!wasmReady) {
		wasmReady = initWasm(read(resvgWasm).arrayBuffer());
	}
	await wasmReady;
	fonts ??= await loadFonts();
	return fonts;
}

/**
 * The poster, as bytes, or nothing.
 *
 * Two seconds and no retry. This runs while a scraper is waiting for an image; a slow CDN must
 * cost us the picture we drew anyway, never the response.
 */
async function fetchPoster(url: string): Promise<string | null> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(2000),
			headers: { accept: 'image/*' }
		});
		if (!response.ok) return null;

		const type = response.headers.get('content-type') ?? '';
		// resvg embeds raster images only; an SVG poster would silently render as nothing.
		if (!/^image\/(jpeg|png|webp)/.test(type)) return null;

		const bytes = new Uint8Array(await response.arrayBuffer());
		// A poster bigger than this is a photograph nobody downscaled, and base64 of it would cost
		// more time to encode than the picture is worth at 1200x630.
		if (bytes.byteLength > 4_000_000) return null;

		return `data:${type.split(';')[0]};base64,${Buffer.from(bytes).toString('base64')}`;
	} catch {
		// Offline, refused, slow, or a source that blocks hotlinking. All the same answer.
		return null;
	}
}

/**
 * Big title, fewer characters. Measured against the widest thing we could find rather than
 * computed: satori will not shrink text to fit, it will overflow the card silently.
 */
function titleSize(title: string): number {
	if (title.length <= 24) return 88;
	if (title.length <= 48) return 68;
	if (title.length <= 80) return 54;
	return 44;
}

/**
 * Four slots, named for where they sit rather than for what an event puts in them, so the site's
 * own card and an event's card are the same drawing with different words in it.
 */
export type OgCard = {
	/** Small mono line at the top. Uppercased here. */
	label: string;
	title: string;
	/** First footer line, in full-strength peach. An event puts its date here. */
	primary: string;
	/** Second footer line, quieter. Omitted when there is nothing to say. */
	secondary: string | null;
	/** Drawn behind a scrim when it can be fetched. Only ever a poster we may redraw. */
	posterUrl: string | null;
};

export async function renderOgImage(card: OgCard): Promise<Uint8Array<ArrayBuffer>> {
	const loaded = await ready();
	const poster = card.posterUrl ? await fetchPoster(card.posterUrl) : null;

	const label = card.label.toUpperCase();

	const svg = await satori(
		h(
			'div',
			{
				style: {
					display: 'flex',
					width: WIDTH,
					height: HEIGHT,
					backgroundColor: NAVY,
					fontFamily: 'Archivo'
				}
			},
			[
				/*
				 * The poster fills the card and the text sits on a navy scrim over it, rather than
				 * beside it. A half-and-half split looked like a template; this looks like the
				 * posters the site is made of.
				 */
				...(poster
					? [
							h('img', {
								src: poster,
								width: WIDTH,
								height: HEIGHT,
								style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' }
							}),
							h('div', {
								style: {
									position: 'absolute',
									top: 0,
									left: 0,
									width: WIDTH,
									height: HEIGHT,
									backgroundColor: 'rgba(30, 44, 74, 0.82)'
								}
							})
						]
					: []),
				// The peach edge every page on the site has at the top.
				h('div', {
					style: {
						position: 'absolute',
						top: 0,
						left: 0,
						width: WIDTH,
						height: 12,
						backgroundColor: PEACH
					}
				}),
				h(
					'div',
					{
						style: {
							display: 'flex',
							flexDirection: 'column',
							justifyContent: 'space-between',
							width: WIDTH,
							height: HEIGHT,
							padding: '76px 72px 64px'
						}
					},
					[
						h(
							'div',
							{
								style: {
									display: 'flex',
									fontFamily: 'Space Mono',
									fontSize: 26,
									letterSpacing: 2,
									color: PEACH_DIM
								}
							},
							label
						),
						h(
							'div',
							{
								style: {
									display: 'flex',
									fontSize: titleSize(card.title),
									fontWeight: 700,
									lineHeight: 1.05,
									color: PEACH,
									/*
									 * A ceiling rather than a guess. The longest title in the corpus is
									 * 161 characters and wraps to four lines at the smallest step, which
									 * measures 185px and clears the footer; this stops a longer one
									 * growing into it.
									 */
									maxHeight: 320,
									overflow: 'hidden'
								}
							},
							card.title
						),
						h(
							'div',
							{
								style: {
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'flex-end',
									fontFamily: 'Space Mono',
									fontSize: 26,
									color: PEACH_DIM
								}
							},
							[
								h('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: 780 } }, [
									h('div', { style: { display: 'flex', color: PEACH } }, card.primary),
									...(card.secondary
										? [h('div', { style: { display: 'flex' } }, card.secondary)]
										: [])
								]),
								h(
									'div',
									{
										style: {
											display: 'flex',
											backgroundColor: PEACH,
											color: NAVY_DEEP,
											fontFamily: 'Archivo',
											fontWeight: 700,
											fontSize: 24,
											padding: '10px 18px'
										}
									},
									'hendingar.no'
								)
							]
						)
					]
				)
			]
		),
		{ width: WIDTH, height: HEIGHT, fonts: loaded }
	);

	const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
	/*
	 * Copied into an array we know is backed by a plain ArrayBuffer. resvg types its output over
	 * `ArrayBufferLike`, which could be a SharedArrayBuffer and so is not a `BodyInit` — and a cast
	 * to pretend otherwise is exactly what CLAUDE.md rule 4 is about. The copy is one memcpy of a
	 * hundred kilobytes, next to a layout and a rasterise.
	 */
	const body = new Uint8Array(png.byteLength);
	body.set(png);
	return body;
}
