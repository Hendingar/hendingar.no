import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { POSTER_CONTAINER_URL } from '$app/env/private';

/**
 * Keeping the poster somebody sent in, for events that were approved.
 *
 * Written with the container app's managed identity — there is no account key here and none in the
 * environment, because `allowSharedKeyAccess` is off on the account. Read by anyone with the URL,
 * which is deliberate: these are thumbnails on public event pages, and putting a Node process in
 * front of every one of them would buy no privacy.
 *
 * Optional throughout. Without `POSTER_CONTAINER_URL` the submission flow works exactly as it did
 * and simply keeps no image, which is what a contributor running this with no Azure account gets.
 */

export function posterStorageEnabled(): boolean {
	return Boolean(POSTER_CONTAINER_URL);
}

/** JPEG only. The browser re-encodes before sending, so this is the one type we ever receive. */
const CONTENT_TYPE = 'image/jpeg';

/** Comfortably above a cropped, downscaled thumbnail and far below anything worth storing. */
export const MAX_POSTER_BYTES = 2 * 1024 * 1024;

let container: ContainerClient | null = null;

function client(): ContainerClient {
	if (container) return container;
	if (!POSTER_CONTAINER_URL) throw new Error('poster storage is not configured');

	/*
	 * The container URL is split rather than passed whole.
	 *
	 * `new ContainerClient(url, credential)` works, but building it from the service client keeps
	 * one code path for the credential and makes the account and container names explicit in a
	 * stack trace — which is the difference between "403" and "403 on which container".
	 */
	const url = new URL(POSTER_CONTAINER_URL);
	const name = url.pathname.replace(/^\/+|\/+$/g, '');
	const service = new BlobServiceClient(url.origin, new DefaultAzureCredential());
	container = service.getContainerClient(name);
	return container;
}

/**
 * Store one poster and return its public URL.
 *
 * Named by event id, so a second upload for the same event overwrites rather than accumulating —
 * and so a blob is traceable to the row that owns it without a lookup table. Not a random name:
 * an orphaned blob nobody can attribute is the thing that makes a bucket impossible to clean up.
 */
export async function storePoster(eventId: number, jpeg: Uint8Array): Promise<string> {
	const blob = client().getBlockBlobClient(`${eventId}.jpg`);
	await blob.uploadData(jpeg, {
		blobHTTPHeaders: {
			blobContentType: CONTENT_TYPE,
			// A poster never changes once an event is approved, and the name is unique per event,
			// so it can be cached hard. A revision that replaces it gets a new event id.
			blobCacheControl: 'public, max-age=31536000, immutable'
		}
	});
	return blob.url;
}

/**
 * Remove a poster, if there is one.
 *
 * Used when an event stops being published. Silent on a missing blob: the caller is deleting
 * something that may never have existed, and treating that as an error would make the caller
 * guard a case that does not matter.
 */
export async function removePoster(eventId: number): Promise<void> {
	if (!posterStorageEnabled()) return;
	await client().getBlockBlobClient(`${eventId}.jpg`).deleteIfExists();
}
