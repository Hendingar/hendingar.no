import { safeHttpUrl } from './source-link.ts';

/**
 * What a shared link to an event shows, when it is not our generated card.
 *
 * `og.png` only paints a poster whose rights are verified — a photograph somebody sent us —
 * because drawing it into our card is making a copy. Every imported poster is hotlinked instead,
 * exactly as the <img> on the event page is, so a link preview showed our generated tile even for
 * a concert with a perfectly good poster. Pointing the preview at the poster where it already
 * lives is the same hotlink, made by the scraper rather than the reader's browser; nothing is
 * copied.
 *
 * HTTPS only: iMessage and Facebook drop a plain-http image without saying so, and the generated
 * card is a better preview than a blank one. Null means "use `og.png`".
 */
export function hotlinkedShareImage(event: {
	posterUrl: string | null;
	posterRightsVerified: boolean;
}): string | null {
	if (event.posterRightsVerified || !event.posterUrl?.startsWith('https://')) return null;
	return safeHttpUrl(event.posterUrl);
}
