/**
 * URL slugs.
 *
 * `eventPath` produces `/hending/123-tittel`. The id leads and is authoritative; the slug is
 * decoration for readability and for sharing. That means a retitled event never 404s and never
 * needs a redirect, and there is no slug column to keep unique — which for a listing that imports
 * a hundred events a day from a source we do not control is the difference between a feature and a
 * migration.
 */

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/g, '');
}

export function eventPath(id: number, title: string): string {
	const slug = slugify(title);
	return slug ? `/hending/${id}-${slug}` : `/hending/${id}`;
}

/**
 * Read the id back out of a slug parameter. Anything after the leading digits is ignored, so an
 * out-of-date or hand-mangled slug still resolves to the right event.
 */
export function eventIdFromParam(param: string): number | null {
	const match = /^(\d+)/.exec(param);
	if (!match) return null;
	const id = Number(match[1]);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}
