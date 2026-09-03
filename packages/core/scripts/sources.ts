/**
 * Registers the sources we link to but do not collect.
 *   pnpm db:sources
 *
 * Idempotent, and safe to run beside the importers: it only ever touches the slugs in
 * LINKED_SOURCES, and it deliberately does NOT reset `kind`, `endpoint` or `scheduleCron` on a row
 * an importer has since taken over. If a source graduates from link to collected, the importer
 * owns it and this script must not drag it back.
 */
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db.ts';
import { LINKED_SOURCES } from '../src/directory.ts';
import { sources } from '../src/schema.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` (it creates .env from .env.example).');
	process.exit(1);
}

const db = createDb(url);

let added = 0;
let updated = 0;
let skipped = 0;

for (const entry of LINKED_SOURCES) {
	const [existing] = await db
		.select({ id: sources.id, kind: sources.kind })
		.from(sources)
		.where(eq(sources.slug, entry.slug))
		.limit(1);

	if (existing && existing.kind !== 'link') {
		// An importer collects this now. Leave it entirely alone.
		skipped += 1;
		continue;
	}

	const values = {
		name: entry.name,
		url: entry.url,
		region: entry.region,
		attribution: entry.attribution,
		iconUrl: entry.iconUrl,
		note: entry.note,
		kind: 'link' as const,
		endpoint: null,
		scheduleCron: null,
		trusted: false,
		// Not active: it is not being collected, and the summary counts on /datasamling must keep
		// meaning "sources we actually gather from".
		active: false
	};

	if (existing) {
		await db.update(sources).set(values).where(eq(sources.id, existing.id));
		updated += 1;
	} else {
		await db.insert(sources).values({ slug: entry.slug, ...values });
		added += 1;
	}
}

console.log(
	`linked sources: ${added} added, ${updated} updated, ${skipped} left to their importer`
);
process.exit(0);
