<script lang="ts">
	import { CATEGORIES } from '@hendingar/core/taxonomy';
	import { DEFAULT_TIME_ZONE, formatEventTime, formatTimeDigits } from '@hendingar/core/datetime';
	import {
		RECURRENCE_FREQUENCIES,
		WEEKDAY_NAMES,
		WEEKDAYS,
		describeRecurrence,
		expandRecurrence,
		type Weekday
	} from '@hendingar/core/recurrence';
	import type { ExtractedEvent } from '@hendingar/core/validation';
	import {
		VERIFICATION_CHECK_FIELDS,
		VERIFICATION_CHECK_HINTS,
		VERIFICATION_CHECK_LABELS,
		VERIFICATION_VERDICT_LABELS,
		type VerificationCheck,
		type VerificationVerdict
	} from '@hendingar/core/verification';
	import { coveredMunicipalitiesSentence } from '@hendingar/core/coverage';
	import { CHECK_COUNT_WORD_LEADING } from '../../checks.ts';
	import {
		cropSuggestion,
		contributionTarget,
		findDuplicate,
		submissionDraft,
		submissionVerdict,
		submitEvent,
		type ContributionTarget
	} from '../../submit.remote';
	import { describeFields } from '@hendingar/core/contribution';
	import { ensureClientId, existingClientId } from '../../client-id.ts';
	import { claimTypedBeforeHydration } from '../../typed-before-hydration.ts';
	import { cropToThumbnail, type CapturedImage } from '../../poster.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import { photoFilledFields } from '../../provenance.ts';
	import PhotoCapture from './PhotoCapture.svelte';
	import PosterField from './PosterField.svelte';
	import UrlCapture from './UrlCapture.svelte';
	import VerdictPanel from './VerdictPanel.svelte';
	import { page } from '$app/state';
	import { afterNavigate, pushState } from '$app/navigation';
	import { track } from '../../analytics.ts';

	let {
		photoEnabled,
		revisionOf = null,
		contributeTo = null
	}: {
		photoEnabled: boolean;
		/** Set when this form is revising a submission that did not pass its checks. */
		revisionOf?: number | null;
		/**
		 * Set when this submission is improving an event we already have, rather than adding one.
		 *
		 * `?bidra=<id>`. Reached two ways, and both matter: from the duplicate banner below, before
		 * anything has been sent, and from a receipt or the queue for a submission the duplicate
		 * check already held back — which is the case this exists for.
		 */
		contributeTo?: number | null;
	} = $props();

	/**
	 * The event being improved, once we know it is real.
	 *
	 * Null while loading and null if the id names nothing publishable, and the form behaves as an
	 * ordinary submission in both cases — which is the right failure. `?bidra=` is a hint from a
	 * URL, so a stale or invented id must leave somebody in front of a working form rather than in
	 * front of an error about a query parameter.
	 */
	let target = $state<ContributionTarget | null>(null);
	const contributing = $derived(target !== null);

	/*
	 * Who is sending this, so they can find it again in /kø and revise it until it passes.
	 *
	 * Starts as whatever this browser already has, and is only *minted* once somebody actually
	 * types into the form. Merely opening /send-inn should not write an identifier for a person who
	 * then changes their mind — the first keystroke is the point at which they have asked to be
	 * remembered, and it is comfortably before they can submit.
	 *
	 * Empty during SSR, since there is no localStorage there. A submission without an id still goes
	 * through; it simply cannot be revised later.
	 */
	let submitterId = $state(existingClientId() ?? '');

	/**
	 * Open a revision already filled in.
	 *
	 * `?rett=<id>` used to carry only the id — the server knew which row to replace, and the fields
	 * knew nothing, so correcting one wrong date meant retyping the other ten. That is the kind of
	 * friction that makes people abandon the loop rather than use it.
	 *
	 * Client-side, because the values are scoped to this browser's id and the server cannot know
	 * that before the page loads. `NOT_LOADED` rather than a boolean pair: "not asked yet",
	 * "asked and there was nothing" and "loaded" are three states, and collapsing the first two
	 * shows an empty form as though that were the answer.
	 */
	let revisionLoaded = $state(false);
	let targetLoaded = $state(false);

	$effect(() => {
		if (!contributeTo || targetLoaded) return;
		void contributionTarget({ id: contributeTo })
			.then((found) => {
				target = found;
				/*
				 * Fill in the event's own identity — but only when there is no draft coming.
				 *
				 * `f.set` replaces rather than merges (see the note on `prefill`), so doing this
				 * alongside a revision would race the draft and one of the two would win at random.
				 * With `?rett=` the draft already describes the same event, near enough by
				 * definition: it is what the duplicate check matched in the first place.
				 */
				if (found && !revisionOf) {
					f.set({
						title: found.title,
						category: found.category,
						date: found.date,
						startTime: found.startTime,
						venueName: found.venueName,
						municipality: found.municipality || undefined
					});
					mode = 'form';
				}
			})
			.catch(() => {
				// An ordinary submission form is a working page. An error about `?bidra=` is not.
			})
			.finally(() => (targetLoaded = true));
	});

	/**
	 * The checks that did not pass on the submission being corrected.
	 *
	 * Empty for a first submission, and empty for an approved one — there is nothing to fix in
	 * either case. Only the non-passing checks are kept: five green rows above a form buries the
	 * one line that says what to change, which is the same argument /kø's list already makes.
	 */
	let toFix = $state<
		{ check: VerificationCheck; verdict: VerificationVerdict; reasoning: string }[]
	>([]);
	const unresolved = $derived(toFix.filter((c) => c.verdict !== 'pass'));

	/**
	 * The checks that read a given field, so the field can carry its own reason.
	 *
	 * From `VERIFICATION_CHECK_FIELDS` in core rather than a list here: which field a check reads
	 * is a fact about the check, and a second copy in a component goes stale the first time the
	 * verifier changes what it looks at. A scan over a handful of checks per field, which is
	 * cheaper than the reactive Map it replaced and does not need one.
	 */
	function fixesFor(field: string) {
		return unresolved.filter((check) => VERIFICATION_CHECK_FIELDS[check.check].includes(field));
	}
	$effect(() => {
		if (!revisionOf || revisionLoaded) return;
		const id = existingClientId();
		if (!id) {
			revisionLoaded = true;
			return;
		}
		/*
		 * The answer, alongside the draft.
		 *
		 * A form that opens filled in still does not say what was wrong with it — the sender had to
		 * read the checks on the previous page, remember them, and come here to guess which of
		 * eleven boxes they were about. So the same verdict /kø renders is fetched here and put
		 * beside the fields it names. Separate from the draft and allowed to fail on its own: a
		 * form that opens without its reasons is worse, but a form that does not open at all
		 * because the reasons could not be fetched is much worse.
		 */
		void submissionVerdict({ id: revisionOf, clientId: id })
			.then((result) => {
				if (result && result.outcome !== 'approved') toFix = result.checks;
			})
			.catch(() => {
				// Nothing shown, nothing said. The fields are the thing being corrected.
			});

		void submissionDraft({ id: revisionOf, clientId: id })
			.then((draft) => {
				if (!draft) return;
				f.set({
					title: draft.title,
					description: draft.description || undefined,
					category: draft.category,
					date: draft.date,
					startTime: draft.startTime,
					endTime: draft.endTime || undefined,
					venueName: draft.venueName,
					municipality: draft.municipality || undefined,
					organizerName: draft.organizerName || undefined,
					sourceUrl: draft.sourceUrl || undefined,
					ctaUrl: draft.ctaUrl || undefined,
					repeats: draft.repeats,
					repeatWeekdays: draft.repeatWeekdays,
					repeatNth: NTH_VALUES.find((v) => v === draft.repeatNth),
					repeatUntil: draft.repeatUntil || undefined
				});
				method = draft.method === 'photo' || draft.method === 'link' ? draft.method : 'form';
				mode = 'form';
			})
			.catch(() => {
				// An empty form is a worse answer than a slow one, but it is not an error worth
				// showing: the person can still type, and the server checks ownership again anyway.
			})
			.finally(() => (revisionLoaded = true));
	});
	/**
	 * Where to cut the thumbnail, when we know.
	 *
	 * The model that reads a poster returns a box along with the fields, so the photo path gets one
	 * for free. Every other way in has an image and no box, and asks for one at upload time — see
	 * the effect below. Null means "no box": the whole picture, in a centred landscape band, which
	 * is still a truer card than a generated pattern.
	 */
	let posterCrop = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	/**
	 * The image is sent a second time, and only for an event that was approved.
	 *
	 * This is the whole reason it is not attached to the submission: an event that turns out to be
	 * declined, shady or a duplicate never has its picture leave the browser at all, so there is
	 * nothing on our side to delete afterwards. Nothing was ever received.
	 *
	 * Cropped here rather than on the server, using the box the model produced while it was
	 * reading the poster — no image library in the app, and no image processing on a 0.25 vCPU
	 * container. Failure is silent: the event is already published, and a missing thumbnail is not
	 * worth an error message about something the person did not ask for.
	 */
	/**
	 * A verdict, reported once.
	 *
	 * Open submission is the thing this project is betting on, and until now nothing said whether
	 * it worked: how many people try, which of the three ways in they use, and which of the five
	 * checks turns them away. "Declined" outnumbering "approved" would be a product problem we
	 * currently could not see.
	 *
	 * The method and the outcome, and nothing else. Not the title, not the venue, not the id —
	 * what somebody tried to submit is theirs, and an event that was declined is one we agreed not
	 * to keep (ADR 0012).
	 *
	 * Latched on the event id rather than on a boolean, because the effect re-runs whenever the
	 * poster upload moves state and a second report would double every submission that carried a
	 * picture.
	 */
	/**
	 * The verdict belongs to the submission that produced it — not to the next visit.
	 *
	 * `submitEvent.result` is documented as ephemeral: it "will vanish if you resubmit, navigate
	 * away, or reload the page". On a reload it does. On a *client-side* navigation it does not —
	 * the form module holds it — so arriving at /send-inn again renders the previous answer where
	 * the form should be, and there is no form on the page at all.
	 *
	 * Both doors were reported. Following "Rett og send inn på nytt" out of /kø handed the sender
	 * back the rejection they had just read, and the `pushState` effect below then rewrote the
	 * address bar to the receipt — so asking to correct an event took you to the verdict for it.
	 * The nav's own "Send inn" link did the same thing, which meant a second event could not be
	 * sent without reloading. Every e2e spec covering this used `page.goto(href)`, a full load,
	 * which is exactly the one navigation that clears the result: the specs could not see it.
	 *
	 * So: a result counts as ours if this page produced it. Two ways that happens.
	 *
	 *  - With JavaScript, `submitEvent.pending` rises before the result lands.
	 *  - Without it, the browser POSTs for real and the response renders at the form's own action
	 *    URL, which carries `?/remote=…`. Read from the URL rather than from `$app/environment`'s
	 *    `browser`, because the server render and the hydrated client must agree — a flag that is
	 *    true on the server and false after hydration makes the verdict disappear on somebody
	 *    whose JavaScript merely arrived late. That class of bug is what
	 *    `typed-before-hydration.ts` exists for.
	 */
	const submittedWithoutJs = $derived(page.url.searchParams.has('/remote'));
	let submittedHere = $state(false);
	$effect(() => {
		if (submitEvent.pending > 0) submittedHere = true;
	});

	/*
	 * A real navigation starts a new visit, and the previous verdict is not its answer.
	 *
	 * Needed in addition to the flag above because /send-inn → /send-inn is the *same route*, so
	 * SvelteKit reuses the component and nothing resets on its own. That is the door the nav's own
	 * "Send inn" link goes through, and without this the panel stays where the form should be.
	 *
	 * `shallow` is what keeps the `pushState` below from undoing itself: giving the verdict a URL
	 * is a shallow navigation, not a new visit.
	 */
	afterNavigate((navigation) => {
		if (!navigation.shallow) submittedHere = false;
	});

	const verdict = $derived(submittedHere || submittedWithoutJs ? submitEvent.result : undefined);

	let reportedResult = $state<string | null>(null);

	$effect(() => {
		const result = verdict;
		if (!result?.outcome) return;
		const key = `${method}:${result.outcome}:${result.eventId ?? 'none'}`;
		if (reportedResult === key) return;
		reportedResult = key;
		track('submit_result', { method, outcome: result.outcome });
	});

	let posterState = $state<'idle' | 'saving' | 'saved' | 'skipped'>('idle');

	$effect(() => {
		const result = verdict;
		if (!result || posterState !== 'idle') return;
		/*
		 * `posterWanted` rather than the outcome.
		 *
		 * Two unrelated situations want the image and they have nothing else in common: an approved
		 * submission keeps its own poster, and a contribution fills the gap on an event that has
		 * none. The server decides which, because only it knows whether the event being improved
		 * already had a picture — the browser asking "was this approved?" cannot tell.
		 */
		if (!result.posterWanted || !result.eventId || !poster) return;

		posterState = 'saving';
		void (async () => {
			try {
				/*
				 * A box from the model, if we can get one — and the whole picture if we cannot.
				 *
				 * The photo path already has one: reading a poster returns the crop along with the
				 * fields, at no extra cost. An image attached to the form has never been looked at,
				 * so this asks for a box and nothing else, once, here — after the verdict, so an
				 * event that was declined still never has its picture leave the browser.
				 *
				 * Everything about it is best effort. No verifier, a slow answer, a nonsensical box:
				 * `cropToThumbnail` takes a centred landscape band of the whole image instead, which
				 * is what the person sent us and a better card than a generated pattern.
				 */
				if (!posterCrop && posterBase64 && photoEnabled) {
					posterCrop = await cropSuggestion({
						imageBase64: posterBase64,
						mediaType: 'image/jpeg'
					}).catch(() => null);
				}

				const blob = await cropToThumbnail(poster!, posterCrop);
				if (!blob) {
					posterState = 'skipped';
					return;
				}
				const response = await fetch(`/ko/${result.eventId}/bilete`, {
					method: 'POST',
					headers: { 'content-type': 'image/jpeg', 'x-client-id': ensureClientId() },
					body: blob
				});
				posterState = response.ok ? 'saved' : 'skipped';
			} catch {
				posterState = 'skipped';
			}
		})();
	});

	function claimIdentity() {
		if (!submitterId) submitterId = ensureClientId();
	}

	const f = submitEvent.fields;

	/** Provenance. Set once a photo actually fills the form, so /datasamling can count honestly. */
	let method = $state<'form' | 'photo' | 'link'>('form');

	/** How the form introduces itself, per way in. Keyed so a fourth way cannot silently read as a form. */
	const INTRO_LABEL: Record<'form' | 'photo' | 'link', string> = {
		form: 'Skjema',
		photo: 'Forslag frå biletet',
		link: 'Forslag frå sida'
	};
	const INTRO_HEADING: Record<'form' | 'photo' | 'link', string> = {
		form: 'Skriv det inn',
		photo: 'Sjekk at dette stemmer',
		link: 'Sjekk at dette stemmer'
	};
	const INTRO_LEDE: Record<'form' | 'photo' | 'link', string> = {
		form: '',
		photo:
			'Dette er eit forslag, lese ut av biletet. Rett det som er feil og fyll inn resten — ingenting blir sendt før du trykkjer send.',
		link: 'Dette er eit forslag, lese frå sida du lenkja til. Rett det som er feil og fyll inn resten — ingenting blir sendt før du trykkjer send.'
	};
	/** Fields the model admitted it could not read, so we can point at them instead of hiding it. */
	let unreadable = $state<string[]>([]);

	/**
	 * The image this submission carries, kept for the whole submission.
	 *
	 * Extraction switches to the form panel, which hides the panel the image was pasted into — so
	 * it used to vanish at the moment it became useful. Held here it stays beside the fields it
	 * produced, and is still on screen with the verdict afterwards.
	 *
	 * No longer only a read poster. It is set the moment somebody chooses a picture — from the photo
	 * shortcut, whether or not the read then succeeds, or from the field in the form — and it is
	 * what becomes the thumbnail if the event is approved.
	 */
	let poster = $state<string | null>(null);
	/**
	 * The same bytes without the `data:` prefix, for the crop call.
	 *
	 * Kept beside the data URL rather than derived from it at the point of use: the two are produced
	 * together by `downscaleForUpload`, and splitting a string on a comma to recover something we
	 * already had is the kind of small cleverness that goes wrong on the one browser that formats
	 * the URL differently.
	 */
	let posterBase64 = $state<string | null>(null);

	/**
	 * Somebody chose a picture — from either way in.
	 *
	 * The crop is cleared rather than kept: a new picture has nothing to do with the box the model
	 * found in the last one, and applying it would cut a stranger's photograph to a shape chosen
	 * for a poster nobody can see any more.
	 */
	function attachImage(image: CapturedImage) {
		poster = image.dataUrl;
		posterBase64 = image.base64;
		posterCrop = null;
	}

	function clearImage() {
		poster = null;
		posterBase64 = null;
		posterCrop = null;
	}

	/**
	 * Which fields the image filled in.
	 *
	 * The form already said what it could NOT read; it never said what it DID. Without that, a
	 * reader cannot tell a value the model lifted off a poster from one they typed themselves,
	 * which is the difference between checking and re-entering.
	 *
	 * A field leaves the set the moment it is edited: once a person has corrected it, it is theirs
	 * and claiming otherwise would be worse than saying nothing.
	 */
	const fromPhoto = new SvelteSet<string>();

	/**
	 * A SvelteSet rather than `$state(new Set())`.
	 *
	 * This is real reactive state — ten badges read it and every keystroke can change it — so the
	 * reactive collection is the right tool, and it also lets the set be mutated in place instead
	 * of rebuilt on every edit. (The one place a plain built-in was correct was `filterHref`'s
	 * throwaway URLSearchParams, which nothing renders from.)
	 */
	function ownField(name: string) {
		fromPhoto.delete(name);
	}

	/** One spelling of the route this form lives at, used by both of the effects below. */
	const SUBMIT_PATH = '/send-inn';

	/**
	 * Which way the person is submitting.
	 *
	 * Backed by a real radio group rather than JavaScript tabs, so the panels switch with CSS
	 * `:checked` and both are present in the server-rendered HTML. With JavaScript off the tabs
	 * still work; with fake tabs the form would simply be unreachable.
	 *
	 * `/send-inn?med=bilete` opens on the photo panel, so the entry point can be linked to
	 * directly. Read once, on the way in.
	 *
	 * Deliberately NOT written back as the tab changes. Doing that with `replaceState` re-runs the
	 * page, and the re-run fights `bind:group`: the radio is checked by the click and unchecked
	 * again by the render, so the tabs stop working altogether. The address bar following the tab
	 * is worth very little; the tabs working without JavaScript is worth a lot, and that mechanism
	 * was here first.
	 */
	const MODE_BY_PARAM: Record<string, 'photo' | 'link'> = { bilete: 'photo', lenkje: 'link' };
	let mode = $state<'form' | 'photo' | 'link'>(
		MODE_BY_PARAM[page.url.searchParams.get('med') ?? ''] ?? 'form'
	);

	/**
	 * Give the verdict a URL, without throwing away what is on screen.
	 *
	 * `pushState` rather than `goto`: the panel shows the poster the fields were read from, and
	 * that image only exists in this browser's memory — for anything but an approved submission it
	 * is never uploaded at all, deliberately. A real navigation would lose it at the exact moment
	 * the checks are being read.
	 *
	 * What this buys is that the address bar now names the answer. Reloading, or opening the URL
	 * later, lands on the real route, which reads the verdict back from the database; the back
	 * button returns to the form. Before this, a reload silently discarded the whole result.
	 */
	let addressed = $state(false);
	$effect(() => {
		const result = verdict;
		if (!result?.eventId || addressed) return;
		addressed = true;
		pushState(`${SUBMIT_PATH}/kvittering/${result.eventId}`, page.state);
	});
	let intro: HTMLElement | undefined = $state();

	/**
	 * Keep the time fields in 24-hour form.
	 *
	 * A text input rather than `type="time"`: the native control renders in the *browser's* locale,
	 * so an English-locale browser showed "04:30 PM" on a Nynorsk form and nothing in HTML or CSS
	 * can override it. Formatting on input means a numeric keypad is enough — typing 1930 or 930
	 * both land correctly, so we lose the native clock picker but never the 24-hour clock.
	 */
	function onTimeInput(field: typeof f.startTime, value: string) {
		field.set(formatTimeDigits(value));
	}

	/**
	 * A likely duplicate, found before the form is filled in.
	 *
	 * Asked as soon as an extraction gives us a title and a time, which is before the person has
	 * typed anything. Finding out at the end — having written a description, a venue and an
	 * organiser — is the worst possible moment to learn the work was unnecessary.
	 *
	 * Advisory, never a block. They may well be looking at a different evening of the same show,
	 * and the server decides again from the values actually submitted.
	 */
	let likelyDuplicate = $state<Awaited<ReturnType<typeof findDuplicate>> | null>(null);
	let duplicateDismissed = $state(false);

	async function probeForDuplicate(
		date: string,
		startTime: string,
		venueName: string,
		title: string
	) {
		likelyDuplicate = null;
		duplicateDismissed = false;
		if (!date || !startTime || !title) return;
		try {
			likelyDuplicate = await findDuplicate({
				title,
				date,
				startTime,
				timeZone: DEFAULT_TIME_ZONE,
				venueName: venueName || null
			});
		} catch {
			// A failed probe is a missing courtesy, not a failed submission. The server checks again.
		}
	}

	/**
	 * The same handover as a read poster, from a read page.
	 *
	 * Routed through `prefill` rather than duplicating it — everything after "we have a draft" is
	 * identical, including the duplicate probe and the recurrence expansion, and the one place that
	 * logic was written twice is what CLAUDE.md warns about. Two things differ and both are set
	 * afterwards: the method, because nobody photographed anything, and the source URL, because a
	 * link submission has one by definition and it is the whole reason to trust the draft.
	 */
	function prefillFromUrl(draft: ExtractedEvent, sourceUrl: string) {
		/*
		 * The source URL goes through `prefill`, not a second `fields.set` afterwards.
		 *
		 * A follow-up `f.set({ sourceUrl })` does not merge with the one before it — it left the
		 * form holding the URL and nothing else, so a page that read perfectly arrived as an empty
		 * form with a single field filled. Measured, not guessed: the server returned the whole
		 * draft and the duplicate probe matched on its title, while every input on screen was blank.
		 */
		prefill(draft, null, { sourceUrl });
		method = 'link';
		/*
		 * The badges say "lese frå biletet", which is not what happened.
		 *
		 * Provenance is still worth showing — these fields were read, not typed — but it needs its
		 * own wording, so until the badge can say "lese frå sida" it is cleared rather than left
		 * telling the person something untrue about where their data came from.
		 */
		fromPhoto.clear();
	}

	function prefill(
		draft: ExtractedEvent,
		imageDataUrl: string | null = null,
		/** Extra fields, written in the SAME `fields.set` call — see `prefillFromUrl`. */
		extra: { sourceUrl?: string } = {}
	) {
		/*
		 * The image, and the box the model found in it — but only when this draft came FROM an
		 * image.
		 *
		 * A draft read from a linked page has neither, and must not clear a picture the person
		 * attached to the form before pasting the link. `onimage` has usually set `poster` already
		 * by the time we get here; assigning it again keeps this the one place that has to be right
		 * if that ever stops being true.
		 */
		if (imageDataUrl) {
			poster = imageDataUrl;
			// Kept for the upload that happens *after* a verdict of `approved`, and only then.
			posterCrop = draft.thumbnail ?? null;
		}
		/*
		 * A non-null field is one the model read. `unreadable` is the model's own admission and is
		 * kept separate: "could not read" and "did not appear on the poster" look the same in the
		 * data but are different things to tell someone.
		 */
		fromPhoto.clear();
		for (const field of photoFilledFields(draft)) fromPhoto.add(field);
		method = 'photo';
		// A read poster is only a suggestion. Show the person the filled-in form immediately so
		// they can correct it — that review step is the whole reason this is safe.
		mode = 'form';
		intro?.focus();
		unreadable = draft.unreadable;

		/*
		 * A recurring poster states a rule and no date, so `date` came back empty on a required
		 * field: the poster read perfectly and the form was still a dead end. Fill the rule in and
		 * compute the first matching date from today, so there is something to submit. The
		 * expansion is pure, so it runs here in the browser.
		 */
		/*
		 * The soonest listed date, not the first one printed.
		 *
		 * A poster read in November still lists August at the top. Sorting and taking the earliest
		 * that has not passed puts something usable in the box; the rest go in `extraDates`.
		 */
		let firstDate = draft.date ?? undefined;
		if (!firstDate && (draft.dates?.length ?? 0) > 0) {
			const today = new Date().toLocaleDateString('sv-SE');
			const sorted = [...draft.dates].sort();
			firstDate = sorted.find((d) => d >= today) ?? sorted[0];
		}
		if (draft.recurrence) {
			const today = new Date().toLocaleDateString('sv-SE'); // sv-SE renders as YYYY-MM-DD
			const [next] = expandRecurrence({
				recurrence: draft.recurrence,
				anchorDate: draft.date ?? today,
				startTime: draft.startTime ?? '12:00',
				from: today,
				to: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`,
				limit: 1
			});
			firstDate ??= next?.localDate;
		}
		// Only overwrite with what was actually read. A null from the model is "I could not tell",
		// not "clear the box the person already typed in".
		f.set({
			title: draft.title ?? undefined,
			description: draft.description ?? undefined,
			category: draft.category ?? undefined,
			date: firstDate,
			startTime: draft.startTime ?? undefined,
			endTime: draft.endTime ?? undefined,
			venueName: draft.venueName ?? undefined,
			municipality: draft.municipality ?? undefined,
			organizerName: draft.organizerName ?? undefined,
			ctaUrl: draft.ticketUrl ?? undefined,
			repeats: draft.recurrence?.freq ?? 'nei',
			repeatWeekdays: draft.recurrence?.weekdays.map(String) ?? [],
			/*
			 * Everything after the first, since `date` holds that one.
			 *
			 * A poster listing four Thursdays is four events. Reading only the first is what put
			 * an already-passed date in the box and lost the other three.
			 */
			extraDates: (draft.dates ?? []).filter((d) => d !== firstDate),
			// Narrowed to the option values the select offers, so an out-of-range nth from the model
			// is dropped rather than written into a field that cannot hold it.
			repeatNth: NTH_VALUES.find((v) => v === String(draft.recurrence?.nth ?? '')),
			repeatUntil: draft.recurrence?.until ?? undefined,
			...extra
		});

		/*
		 * Ask now, not at the end.
		 *
		 * Deliberately not awaited: the form is already usable and the answer, when it arrives,
		 * appears above it. Blocking the person from typing while we check would trade one wasted
		 * minute for another.
		 */
		void probeForDuplicate(
			firstDate ?? '',
			draft.startTime ?? '',
			draft.venueName ?? '',
			draft.title ?? ''
		);
	}

	/**
	 * And again whenever the fields say something new.
	 *
	 * The probe originally ran only after an extraction, which meant somebody typing the form by
	 * hand — the majority — never got the check at all until they pressed send. It watches the four
	 * fields the comparison actually uses, and debounces, so a title being typed one letter at a
	 * time is one request rather than thirty.
	 */
	let probeTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const title = f.title.value() ?? '';
		const date = f.date.value() ?? '';
		const startTime = f.startTime.value() ?? '';
		const venueName = f.venueName.value() ?? '';

		clearTimeout(probeTimer);
		if (!title || !date || !startTime) {
			likelyDuplicate = null;
			return;
		}
		probeTimer = setTimeout(() => void probeForDuplicate(date, startTime, venueName, title), 500);
		return () => clearTimeout(probeTimer);
	});

	const NTH_VALUES = ['1', '2', '3', '4', '5', '-1'] as const;

	/** What the repeat select can hold. From core, so a new frequency needs no second edit here. */
	const REPEAT_VALUES = ['nei', ...RECURRENCE_FREQUENCIES] as const;

	/**
	 * The extra dates currently in the form, so the list and the posted values cannot disagree.
	 *
	 * Narrowed to real strings: a form array field can hold holes, and rendering `undefined` as a
	 * date would put "Invalid Date" in a chip.
	 */
	const extraDates = $derived(
		(f.extraDates.value() ?? []).filter((d): d is string => typeof d === 'string' && d.length > 0)
	);

	function dropDate(day: string) {
		f.extraDates.set(extraDates.filter((d) => d !== day));
	}

	/** "torsdag 29. oktober" — the date as somebody would read it off the poster. */
	function formatListedDate(day: string): string {
		const [year, month, date] = day.split('-').map(Number);
		return new Intl.DateTimeFormat('nn-NO', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(new Date(Date.UTC(year!, month! - 1, date!, 12)));
	}

	const repeating = $derived(Boolean(f.repeats.value()) && f.repeats.value() !== 'nei');

	/** Live echo of the chosen rule, so nobody has to reason about checkboxes in their head. */
	const repeatSummary = $derived.by(() => {
		const repeats = f.repeats.value();
		if (!repeats || repeats === 'nei') return null;
		const weekdays = (f.repeatWeekdays.value() ?? []).map(Number).filter(Boolean) as Weekday[];
		if (repeats !== 'daily' && weekdays.length === 0) return null;
		const nth = f.repeatNth.value();
		return describeRecurrence({
			freq: repeats as 'daily' | 'weekly' | 'monthly',
			interval: 1,
			weekdays,
			nth: nth ? Number(nth) : null,
			until: (f.repeatUntil.value() as string) || null
		});
	});

	/*
	 * Keep what somebody had already typed when the JavaScript arrived.
	 *
	 * This form is submittable without JavaScript, so it is usable the moment the HTML lands —
	 * which is before hydration, always, and by a long way on a slow phone. Hydration then writes
	 * the (empty) field state over every input and the typing is gone, with nothing said about it.
	 * `claimTypedBeforeHydration` holds the values as the server rendered them; this puts them back
	 * before the template is hydrated, so the boxes keep what is in them. See the module for the
	 * measurements, and for the four e2e specs this was failing.
	 */
	const typedBefore = claimTypedBeforeHydration();
	if (typedBefore.size > 0) {
		const typed = (id: string) => typedBefore.get(id);
		f.set({
			title: typed('title'),
			description: typed('description'),
			// Narrowed against the canonical list rather than trusted: the state is typed, and a
			// slug that is not a category has no business reaching it (CLAUDE.md rule 1).
			category: CATEGORIES.find((c) => c.slug === typed('category'))?.slug,
			date: typed('date'),
			startTime: typed('startTime'),
			endTime: typed('endTime'),
			venueName: typed('venueName'),
			municipality: typed('municipality'),
			organizerName: typed('organizerName'),
			sourceUrl: typed('sourceUrl'),
			ctaUrl: typed('ctaUrl'),
			repeats: REPEAT_VALUES.find((v) => v === typed('repeats')),
			repeatNth: NTH_VALUES.find((v) => v === typed('repeatNth')),
			repeatUntil: typed('repeatUntil')
		});
		/*
		 * And mint the browser id, which the first keystroke was supposed to do.
		 *
		 * That keystroke reached no listener, so without this a submission typed before hydration
		 * is stored with no sender — invisible in /kø, and impossible to revise afterwards.
		 *
		 * What this cannot reach is somebody who *sends* before hydration too: the browser then
		 * posts the form itself, carrying the empty id it was rendered with, and the submission
		 * lands without a sender. That is the documented no-JavaScript outcome — it goes through,
		 * it simply cannot be revised — and fixing it would mean putting the id somewhere the
		 * server can read, which is a decision about identity, not about hydration.
		 */
		claimIdentity();
	}
</script>

<!--
	The answer takes the page.

	The verdict used to render ABOVE the ways in, with all fourteen fields still sitting below it —
	so nothing in the layout said this was the answer to the thing you just did, and the most
	common next move (read the checks) competed with a form you had already submitted. The panel
	carries its own route forward: /kø, or the CTA on the receipt page.
-->
{#if verdict}
	<VerdictPanel
		status={verdict.status}
		outcome={verdict.outcome}
		duplicateOf={verdict.duplicateOf}
		summary={verdict.summary}
		checks={verdict.checks}
		sourceUrl={verdict.sourceUrl}
		{poster}
	/>
{:else}
	<!--
		The ways in are unconditional. Hiding the photo entry point when no verifier is configured
		made half the page's purpose invisible with nothing to explain the absence — someone looking
		for "upload a picture" simply could not find it. The panel now says why it is unavailable
		instead of disappearing, which is the difference between a degraded feature and a missing one.
	-->
	<div class="modes">
		<!-- The radios must be siblings of both the ways and the panels for the `:checked ~` rules
		     to reach them, so they sit here rather than inside the block they visually belong to. -->
		<input
			class="visually-hidden"
			type="radio"
			id="mode-skjema"
			name="submit-mode"
			value="form"
			bind:group={mode}
		/>
		<input
			class="visually-hidden"
			type="radio"
			id="mode-bilete"
			name="submit-mode"
			value="photo"
			bind:group={mode}
		/>
		<input
			class="visually-hidden"
			type="radio"
			id="mode-lenkje"
			name="submit-mode"
			value="link"
			bind:group={mode}
		/>

		<!--
			Three ways in, ranked — not three tabs of equal weight.

			The hero says "take a picture of the poster, or write it in yourself", and the tab bar
			said the opposite: three identical tabs with the fourteen-field form first, so the
			slowest path was the default and the shortcut the page is built around looked like an
			afterthought. Same radios, same CSS panel switch, same server-rendered HTML — only the
			rank changes, so all three still work with scripting off.
		-->
		<div class="ways">
			<label class="way way--photo" class:way--off={!photoEnabled} for="mode-bilete">
				<span class="way__label">Raskaste vegen</span>
				<span class="way__h display display--md">Med bilete</span>
				<span class="way__what">
					{photoEnabled
						? 'Ta bilete av plakaten, eller eit skjermbilete av ei Facebook-hending. Vi les det og gjev deg eit forslag du sjekkar før noko blir sendt.'
						: 'Bilettolking er ikkje slått på i dette miljøet, så opplasting er mellombels av.'}
				</span>
				<!-- aria-hidden: the radio already carries the selected state for a screen reader,
				     and three cards each announcing "vald" would say it three times. -->
				<span class="way__open" aria-hidden="true">Vald</span>
			</label>
			<label class="way way--link" for="mode-lenkje">
				<span class="way__label">Om hendinga har ei side alt</span>
				<span class="way__h display display--sm">Med lenkje</span>
				<span class="way__what">Lim inn adressa, så hentar vi sida éin gong og les ho.</span>
				<span class="way__open" aria-hidden="true">Vald</span>
			</label>
			<label class="way way--form" for="mode-skjema">
				<span class="way__label">Om du heller vil skrive</span>
				<span class="way__h display display--sm">Med skjema</span>
				<span class="way__what">Fjorten felt, fem av dei påkravde. Same veg, same kontrollar.</span>
				<span class="way__open" aria-hidden="true">Vald</span>
			</label>
		</div>

		<div class="panel panel--photo">
			<!--
				`onimage` fires before the model is called, `onextract` only if it answers. The split
				is the point: a read that fails must cost the draft and not the photograph.
			-->
			<PhotoCapture enabled={photoEnabled} onextract={prefill} onimage={attachImage} />
		</div>
		<div class="panel panel--link">
			<UrlCapture onextract={prefillFromUrl} />
		</div>
		<div class="panel panel--form">
			{@render formPanel()}
		</div>
	</div>
{/if}

<!--
	One mark, used by every field that the image filled.

	It used to spell out "lese frå biletet" on each of them. Ten fields each carrying the same
	four words reads as ten problems rather than as one piece of context, and it pushed the labels
	onto two lines. The words now appear once, in the intro, where the mark is explained; the field
	keeps only the glyph.

	`aria-hidden` on the mark plus a visually-hidden phrase: a screen reader still gets words
	rather than a decorative glyph read out as punctuation.
-->
{#snippet readFrom(name: string)}
	{#if fromPhoto.has(name)}
		<span class="field__from">
			<span aria-hidden="true">◧</span>
			<span class="visually-hidden">lese frå biletet</span>
		</span>
	{/if}
{/snippet}

<!--
	The reason a field is being asked about, at the field.

	`readFrom` above marks a field the picture filled; this marks one a check stopped on. Two
	different questions — "is this what the poster said?" and "this is what did not pass" — so two
	marks rather than one overloaded glyph.

	`role="note"` and real words, not a glyph with a tooltip: this is the sentence the correction
	depends on, and it has to be readable by whoever is reading the form.
-->
{#snippet needsFix(name: string)}
	{#each fixesFor(name) as fix (fix.check)}
		<span class="field__fix" role="note">
			<span class="field__fix-name">
				<span aria-hidden="true">▲</span>
				{VERIFICATION_CHECK_LABELS[fix.check]}
			</span>
			{fix.reasoning}
		</span>
	{/each}
{/snippet}

{#snippet formPanel()}
	<!-- `oninput` mints the browser id on the first keystroke — see `claimIdentity`. -->
	<form {...submitEvent} class="form frame" oninput={claimIdentity}>
		<div bind:this={intro} class="form__intro" tabindex="-1">
			<!--
				Say where the draft came from, because it changes what the person is being asked to do.

				An empty form asks them to write; a filled one asks them to check. Naming the actual
				source — a picture or a page — is what makes "check this" a request they can act on,
				since it tells them what to check it against.
			-->
			{#if target}
				<!--
					A contribution is a different request, so it says so instead of borrowing the
					submission form's heading.

					What lands and what does not is stated up front and specifically, because the
					fields below cannot say it: title, time and place belong to the event being
					improved, and the boxes holding them are read-only. Everything else fills a gap
					only where there is one — nothing already on the event is replaced.
				-->
				<p class="label">Bidrag</p>
				<h2 class="display display--md">Gjer denne betre</h2>
				<p class="form__read">
					Du bidreg til <a href={target.path}>{target.title}</a> —
					{formatEventTime(new Date(target.startsAt), target.venueTimeZone) +
						(target.venueName ? ` · ${target.venueName}` : '')}{target.sourceName
						? `, frå ${target.sourceName}`
						: ''}.
				</p>
				{#if target.gaps.length > 0}
					<p class="form__from">
						Ho manglar {describeFields([...target.gaps])}. Fyller du inn noko av det, blir det
						hennar. Det som alt står der, står der framleis.
					</p>
				{:else}
					<p class="form__from">
						Ho har alt vi treng, så eit bidrag endrar ingenting no — men vi noterer at du stadfesta
						henne.
					</p>
				{/if}
			{:else}
				<p class="label">{INTRO_LABEL[method]}</p>
				<h2 class="display display--md">{INTRO_HEADING[method]}</h2>
				{#if method !== 'form'}
					<p class="form__read">{INTRO_LEDE[method]}</p>
				{/if}
			{/if}
			<!--
				The provenance sentence, said once and here.

				This is what the ◧ on the fields below means, and it is also the only place the
				count is stated — "seven fields" is the thing that tells somebody how much checking
				they are being asked to do, and no per-field badge can say it.
			-->
			{#if fromPhoto.size > 0}
				<!-- "felt" is the same in singular and plural, so no count-dependent wording. -->
				<p class="form__from">
					Vi las {fromPhoto.size} felt frå {method === 'link' ? 'sida' : 'biletet'}. Dei er merkte
					<span aria-hidden="true">◧</span> under — rett det som er feil, så blir det ditt.
				</p>
			{/if}
			{#if unreadable.length > 0}
				<p class="form__unread">Klarte ikkje lese: {unreadable.join(', ')}. Fyll inn sjølv.</p>
			{/if}

			<!--
				What did not pass, said once at the top and again at each field.

				Here so the sender knows how much they are being asked to change before they start
				scrolling; at the field because that is where they act on it. The same two-places
				argument the ◧ mark above makes, and the hint comes from core so this cannot say
				something different from what /kø said on the way in.
			-->
			{#if unresolved.length > 0}
				<div class="form__fix">
					<p class="form__fix-lede">
						Dette stoppa henne sist. Felta det gjeld er merkte
						<span aria-hidden="true">▲</span> under.
					</p>
					<ul class="form__fix-list">
						{#each unresolved as check (check.check)}
							<li>
								<span class="form__fix-name">{VERIFICATION_CHECK_LABELS[check.check]}</span>
								<span class="form__fix-verdict">{VERIFICATION_VERDICT_LABELS[check.verdict]}</span>
								<span class="form__fix-why">{check.reasoning}</span>
								<span class="form__fix-hint">{VERIFICATION_CHECK_HINTS[check.check]}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		{#if likelyDuplicate && !duplicateDismissed && !contributing}
			<!--
				Advisory, and above the fields it would save someone filling in.

				Never a block. Two showings of the same play on consecutive evenings score alike on
				title and venue, and the person in front of us knows which one they went to — so this
				names what we found, links to it, and gets out of the way.

				It used to end with "treng du ikkje sende inn på nytt", which was true and was also a
				dead end: somebody holding a photograph of the poster and a link to the Facebook
				event was being told, politely, that their contribution had nowhere to go. The event
				we found is frequently an imported row with neither. So the same finding now offers
				the useful answer, and names what the row is short of — a specific ask, rather than
				an invitation to help in general.
			-->
			<aside class="dupe-warn">
				<p class="label">Finst denne alt?</p>
				<p class="dupe-warn__lede">
					Vi har ei hending som liknar. Er det den same, treng du ikkje sende henne inn på nytt —
					men du kan gjere henne betre.
				</p>
				<a class="dupe-warn__link" href={likelyDuplicate.path} target="_blank" rel="noopener">
					{likelyDuplicate.title} →
				</a>
				<p class="dupe-warn__meta">
					{formatEventTime(new Date(likelyDuplicate.startsAt), likelyDuplicate.venueTimeZone) +
						(likelyDuplicate.venueName ? ` · ${likelyDuplicate.venueName}` : '')}
				</p>
				{#if likelyDuplicate.gaps.length > 0}
					<p class="dupe-warn__gaps">
						Ho manglar {describeFields([...likelyDuplicate.gaps])}.
					</p>
				{/if}
				<p class="dupe-warn__acts">
					<a class="btn btn--solid" href="/send-inn?bidra={likelyDuplicate.id}">
						{likelyDuplicate.gaps.length > 0
							? 'Ja — gjer henne betre med mitt'
							: 'Ja, det er den same'}
					</a>
					<button
						type="button"
						class="dupe-warn__dismiss"
						onclick={() => (duplicateDismissed = true)}
					>
						Nei, dette er ei anna hending — hald fram
					</button>
				</p>
			</aside>
		{/if}

		<!--
			The picture, beside the fields — offered to every submission, not only to a read poster.

			It used to appear only when the model had read one, and only for as long as that read
			succeeded. Two people lost their picture that way: the one whose poster could not be read,
			who was sent to the form while the photograph was quietly dropped, and the one who simply
			typed their event in and was never asked for an image at all. Both ended up with a
			generated tile on a card they had a real picture for.

			Still shown here rather than back in the photo panel: extraction switches away from that
			panel, so the image someone had just pasted disappeared at the moment they needed to check
			the fields against it. Checking a suggestion without being able to see what it was read
			from is not checking.
		-->
		<div class="form__poster" class:form__poster--filled={poster}>
			<PosterField
				{poster}
				readFromImage={method === 'photo' && fromPhoto.size > 0}
				onpick={attachImage}
				onclear={clearImage}
			/>
		</div>

		<!--
		How the event reached us. Not user-editable, but it must go through the fields API: remote
		forms namespace every input name (`method/<hash>/submitEvent`), so a plain `name="method"`
		is silently dropped on submit. `as('text')` rather than `as('hidden', …)` — the hidden
		accessor crashes Svelte's dev SSR renderer on this version.
	-->
		<input {...f.method.as('text')} type="hidden" value={method} />
		<!--
			Who sent this, so they can find it again in /kø and revise it until it passes.

			Minted only when somebody actually submits — a reader who never sends anything in never
			has an identifier written for them. Same opaque browser id the hearts use; it is not an
			account and carries nothing about the person.
		-->
		<input {...f.clientId.as('text')} type="hidden" value={submitterId} />
		<input {...f.revisionOf.as('text')} type="hidden" value={revisionOf ?? ''} />
		<!--
			Which event this improves — posted only once we have confirmed the id names a published,
			canonical row. A `?bidra=` pointing at nothing then submits as an ordinary event rather
			than as a contribution to something that is not there.
		-->
		<input {...f.contributeTo.as('text')} type="hidden" value={target ? String(target.id) : ''} />

		<fieldset class="group">
			<legend class="group__legend">Hendinga</legend>
			<p class="group__hint">
				{contributing
					? 'Dette er hendinga du bidreg til. Tittel og kategori hennar står fast — skildringa fyller vi berre inn om ho manglar ei.'
					: 'Kva er det, og kva slag hending er det?'}
			</p>
			<div class="grid">
				<p class="field field--wide">
					<label for="title">Tittel</label>
					{@render needsFix('title')}
					{@render readFrom('title')}
					<!--
						Read-only, not disabled.

						A disabled input posts nothing, and this value is still stored on the
						contribution row as the sender's own account of the event. `readonly` keeps
						it in the submission and out of their hands, which is what identity means
						here: see IDENTITY_FIELDS in @hendingar/core/contribution.
					-->
					<input
						id="title"
						{...f.title.as('text')}
						required
						maxlength="200"
						autocomplete="off"
						readonly={contributing}
						oninput={() => ownField('title')}
					/>
					{#each f.title.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field field--wide">
					<label for="description">Beskriving <span class="field__opt">valfritt</span></label>
					{@render needsFix('description')}
					{@render readFrom('description')}
					<textarea
						id="description"
						{...f.description.as('text')}
						rows="4"
						maxlength="5000"
						oninput={() => ownField('description')}
					></textarea>
					{#each f.description.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="category">Kategori</label>
					{@render needsFix('category')}
					{@render readFrom('category')}
					<select
						id="category"
						{...f.category.as('select')}
						required
						oninput={() => ownField('category')}
					>
						<option value="">Vel kategori</option>
						{#each CATEGORIES as category (category.slug)}
							<option value={category.slug}>{category.label}</option>
						{/each}
					</select>
					{#each f.category.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Når</legend>
			<p class="group__hint">
				{contributing
					? 'Dato og starttid kjem frå hendinga. Ei sluttid fyller vi inn om ho manglar ei.'
					: 'Dato og klokkeslett i lokal tid, slik dei er oppgitte.'}
			</p>
			<div class="grid">
				<p class="field">
					<label for="date">{repeating || extraDates.length > 0 ? 'Første dato' : 'Dato'}</label>
					{@render needsFix('date')}
					{@render readFrom('date')}
					<input
						id="date"
						{...f.date.as('date')}
						required
						readonly={contributing}
						oninput={() => ownField('date')}
					/>
					{#each f.date.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>

				{#if extraDates.length > 0}
					<!--
						The other dates the poster listed, shown rather than smuggled through.

						A poster reading "torsdagar: 27.aug. 24.sept. 29.okt. og 26.nov" is four
						evenings, not a repetition — so this is a list, not a rule. Each is removable,
						because the model reads a date wrong often enough that submitting four
						unreviewed ones would be worse than submitting one.
					-->
					<fieldset class="dates field--wide">
						<legend>Fleire datoar frå biletet</legend>
						<p class="dates__hint">
							Biletet listar fleire datoar. Kvar av dei blir ei eiga hending, med same klokkeslett
							og stad. Fjern dei som ikkje stemmer.
						</p>
						<ul class="dates__list">
							{#each extraDates as day (day)}
								<li class="dates__item">
									<span>{formatListedDate(day)}</span>
									<button
										type="button"
										class="dates__drop"
										onclick={() => dropDate(day)}
										aria-label="Fjern {formatListedDate(day)}"
									>
										×
									</button>
									<input {...f.extraDates.as('checkbox', day)} checked hidden />
								</li>
							{/each}
						</ul>
					</fieldset>
				{/if}
				<p class="field">
					<label for="startTime">Startar</label>
					{@render needsFix('startTime')}
					{@render readFrom('startTime')}
					<input
						id="startTime"
						{...f.startTime.as('text')}
						required
						inputmode="numeric"
						maxlength="5"
						placeholder="19:30"
						autocomplete="off"
						readonly={contributing}
						pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
						title="Klokkeslett på 24-timarsform, til dømes 19:30"
						oninput={(e) => {
							ownField('startTime');
							onTimeInput(f.startTime, e.currentTarget.value);
						}}
					/>
					{#each f.startTime.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="endTime">Sluttar <span class="field__opt">valfritt</span></label>
					{@render needsFix('endTime')}
					{@render readFrom('endTime')}
					<input
						id="endTime"
						{...f.endTime.as('text')}
						inputmode="numeric"
						maxlength="5"
						placeholder="19:30"
						autocomplete="off"
						pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
						title="Klokkeslett på 24-timarsform, til dømes 19:30"
						oninput={(e) => {
							ownField('endTime');
							onTimeInput(f.endTime, e.currentTarget.value);
						}}
					/>
					{#each f.endTime.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<!--
					Recurrence is a question inside "Når", not a section of its own.

					It was one of five equally-weighted fieldsets, on screen for every submitter —
					and almost every submission happens once, so most people scrolled past a
					weekday grid, an nth-of-month select and an until-date that had nothing to do
					with them. Folded in here it is one row until the answer is yes, which is also
					where the question belongs: it is part of saying when something happens.
				-->
				<!--
					Not asked at all when contributing.

					A contribution improves one existing row and creates none, so there is nothing
					for a repetition to expand into — `eventFormSchema` refuses the combination
					outright rather than dropping it silently. Leaving the select on screen would
					offer a choice whose only outcome is a validation error.
				-->
				<fieldset class="repeat field--wide" hidden={contributing}>
					<legend class="repeat__legend">Gjentaking</legend>
					<p class="repeat__hint">
						Ein plakat som seier «torsdagar» er ei gjentaking, ikkje ein dato.
					</p>
					<div class="repeat__grid">
						<p class="field">
							<label for="repeats">Skjer det fleire gonger?</label>
							<select id="repeats" {...f.repeats.as('select')}>
								<option value="nei">Nei, éin gong</option>
								<option value="weekly">Kvar veke</option>
								<option value="monthly">Kvar månad</option>
								<option value="daily">Kvar dag</option>
							</select>
						</p>

						{#if repeating && f.repeats.value() !== 'daily'}
							<fieldset class="days field--wide">
								<legend>Vekedagar</legend>
								<div class="days__row">
									{#each WEEKDAYS as day (day)}
										<label class="day">
											<input {...f.repeatWeekdays.as('checkbox', String(day))} />
											<span>{WEEKDAY_NAMES[day].slice(0, 3)}</span>
										</label>
									{/each}
								</div>
								{#each f.repeatWeekdays.issues() ?? [] as issue (issue.message)}
									<span class="field__error">{issue.message}</span>
								{/each}
							</fieldset>
						{/if}

						{#if f.repeats.value() === 'monthly'}
							<p class="field">
								<label for="repeatNth">Kva veke i månaden</label>
								<select id="repeatNth" {...f.repeatNth.as('select')}>
									<option value="1">Første</option>
									<option value="2">Andre</option>
									<option value="3">Tredje</option>
									<option value="4">Fjerde</option>
									<option value="-1">Siste</option>
								</select>
							</p>
						{/if}

						{#if repeating}
							<p class="field">
								<label for="repeatUntil">Til og med <span class="field__opt">valfritt</span></label>
								<input id="repeatUntil" {...f.repeatUntil.as('date')} />
								<span class="field__hint">
									Står det ingen sluttdato, lagrar vi eit halvår framover.
								</span>
								{#each f.repeatUntil.issues() ?? [] as issue (issue.message)}
									<span class="field__error">{issue.message}</span>
								{/each}
							</p>
						{/if}

						{#if repeatSummary}
							<p class="repeat__echo field--wide">
								Blir lagra som: <strong>{repeatSummary}</strong>
							</p>
						{/if}
					</div>
				</fieldset>
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Kvar</legend>
			<p class="group__hint">
				{contributing
					? 'Staden kjem frå hendinga du bidreg til. Eit bidrag flyttar henne ikkje.'
					: 'Staden hendinga går føre seg.'}
			</p>
			<div class="grid">
				<p class="field">
					<label for="venueName">Stad</label>
					{@render needsFix('venueName')}
					{@render readFrom('venueName')}
					<input
						id="venueName"
						{...f.venueName.as('text')}
						required
						maxlength="200"
						readonly={contributing}
						oninput={() => ownField('venueName')}
					/>
					{#each f.venueName.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="municipality">Kommune <span class="field__opt">valfritt</span></label>
					{@render needsFix('municipality')}
					{@render readFrom('municipality')}
					<input
						id="municipality"
						{...f.municipality.as('text')}
						maxlength="100"
						readonly={contributing}
						aria-describedby="municipality-hint"
						oninput={() => ownField('municipality')}
					/>
					<!--
						Optional in the schema, and the thing that decides whether the event goes out
						now. The coverage check reads this box: a covered kommune publishes, an empty
						one is a question that lands in /kø, and somewhere else is a no. A sender who
						is told that here never meets the last two — which is the whole point of
						saying it at the field rather than only in the verdict.
					-->
					<span class="field__hint" id="municipality-hint">
						Vi legg ut hendingar i {coveredMunicipalitiesSentence()}. Skriv kommunen, så går
						hendinga ut med ein gong.
					</span>
					{#each f.municipality.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Kven og kjelde</legend>
			<p class="group__hint">Kven står bak, og kvar kan vi lese meir?</p>
			<div class="grid">
				<p class="field">
					<label for="organizerName">Arrangør <span class="field__opt">valfritt</span></label>
					{@render readFrom('organizerName')}
					<input
						id="organizerName"
						{...f.organizerName.as('text')}
						maxlength="200"
						oninput={() => ownField('organizerName')}
					/>
					{#each f.organizerName.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="ctaUrl">Billettar <span class="field__opt">valfritt</span></label>
					{@render readFrom('ctaUrl')}
					<input id="ctaUrl" {...f.ctaUrl.as('url')} oninput={() => ownField('ctaUrl')} />
					{#each f.ctaUrl.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field field--wide">
					<label for="sourceUrl">
						Lenkje til kjelde <span class="field__opt">valfritt, men hjelper</span>
					</label>
					{@render needsFix('sourceUrl')}
					<input id="sourceUrl" {...f.sourceUrl.as('url')} />
					<span class="field__hint">
						Ei side som omtalar hendinga. Vi lenkjer alltid tilbake til kjelda, og ei lenkje gjer at
						kontrollen kan stadfeste hendinga i staden for å gjette.
					</span>
					{#each f.sourceUrl.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<!--
			The send bar follows the fields down.

			A single button parked after fourteen fields is a long way from wherever the last doubt
			was, and on a phone it is below three screens of form. Split in two so the sticky part
			stays one line tall: the promise that has to be on screen at the moment of sending, and
			the rest of it left in place underneath.
		-->
		<div class="form__send">
			<button class="btn btn--solid" type="submit" disabled={submitEvent.pending > 0}>
				{submitEvent.pending > 0 ? 'Kontrollerer…' : 'Send inn hendinga'}
			</button>
			<p class="form__send-note">
				{CHECK_COUNT_WORD_LEADING} kontrollar går med ein gong — ingen kø, ingen som ventar.
			</p>
		</div>
		<div class="form__foot">
			<p class="form__fine fineprint">
				Går alt gjennom, ligg hendinga ute med det same. Gjer ho ikkje det, finn du henne i
				<a href="/ko">køen din</a> med grunnen, og kan rette og sende inn på nytt. Rører du henne ikkje
				på 48 timar, blir ho sletta.
			</p>
		</div>
	</form>
{/snippet}

<style>
	/*
	 * The poster sits between the intro and the fields, full width of the form.
	 *
	 * Capped in height because a portrait phone photo is otherwise taller than the screen and
	 * pushes every field it is meant to be checked against out of view.
	 */
	/*
	 * Beside the fields once there is room, above them when there is not.
	 *
	 * It sat full-width above the form, which pushed every field a screenful down and meant that
	 * checking the last field against the picture required scrolling the picture off screen —
	 * exactly the comparison the panel exists to make possible.
	 *
	 * The grid trick: the poster is placed in a second column spanning every row, and everything
	 * else is pinned to the first. `grid-row: 1 / -1` is what lets it stay tall enough to be sticky
	 * against the whole form rather than against one field.
	 */
	/* An advisory, not an error: a left rule and dim type, not a red box. */
	.dupe-warn {
		margin: 0 0 1.25rem;
		padding-inline-start: 1rem;
		border-inline-start: var(--rule-fat) solid var(--peach);
		display: grid;
		gap: 0.3rem;
		justify-items: start;
	}
	.dupe-warn__lede {
		margin: 0;
		font-size: 0.9375rem;
	}
	.dupe-warn__link {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: var(--step-mid);
		line-height: 1;
		overflow-wrap: anywhere;
	}
	.dupe-warn__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.dupe-warn__gaps {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
	/*
	 * The two answers side by side, with the useful one weighted.
	 *
	 * "Yes, it is the same" is now an action rather than a full stop, so it gets the solid button
	 * and "no, carry on" stays the quiet link it always was — the person who is adding a genuinely
	 * different event has not been interrupted, they have been asked one question.
	 */
	.dupe-warn__acts {
		margin: 0.6rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 0.9rem;
		align-items: center;
	}
	.dupe-warn__dismiss {
		background: none;
		border: 0;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
		text-decoration: underline;
		text-underline-offset: 0.25em;
		cursor: pointer;
	}
	.dupe-warn__dismiss:hover {
		color: var(--peach-hi);
	}

	.dates {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	.dates legend {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.dates__hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
		max-inline-size: 54ch;
	}
	.dates__list {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.dates__item {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3em 0.5em 0.3em 0.7em;
		border: var(--rule) solid var(--peach-line);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
	}
	.dates__drop {
		background: none;
		border: 0;
		padding: 0 0.2em;
		font-size: 1.1em;
		line-height: 1;
		color: var(--peach-dim);
		cursor: pointer;
	}
	.dates__drop:hover {
		color: var(--peach-hi);
	}

	/*
	 * `PosterField` owns the control; this owns where it sits.
	 *
	 * The rules that reach inside it are `:global`, which is the price of that split — the same
	 * arrangement `EventTile` has with `EventThumb`, and for the same reason: only the parent knows
	 * whether the field is a strip at the top of a phone or a column beside a wide form.
	 *
	 * Everything below is keyed on `--filled`. Empty, the field is a small invitation and must
	 * behave like any other block in the form; a 17rem sticky column reserved for a picture nobody
	 * has attached would be a hole in the layout.
	 */
	.form__poster--filled {
		margin: 0 0 1.25rem;
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		background: var(--navy-900);
	}
	/*
	 * Narrow and filled: a strip that stays put, not a block that scrolls away.
	 *
	 * As an 18rem block above the fields, checking the last field against the picture meant
	 * scrolling the picture off screen — exactly the comparison it is there to make possible. As a
	 * strip it is beside every field in turn, so it keeps only the picture and the two buttons: the
	 * label and the caption are what a sticky element cannot afford on a phone.
	 */
	.form__poster--filled :global(.poster) {
		padding: 0.5rem;
		gap: 0.5rem;
	}
	.form__poster--filled :global(.poster__label),
	.form__poster--filled :global(.poster__fig figcaption) {
		display: none;
	}
	.form__poster--filled :global(.poster__fig) {
		max-inline-size: none;
	}
	.form__poster--filled :global(.poster__fig img) {
		/* The strip crops rather than shrinks: a portrait phone photo letterboxed into 5rem is a
		   sliver of image in a field of background, which is not a reference you can check against. */
		max-block-size: 5rem;
		object-fit: cover;
		object-position: center top;
	}

	@container (min-width: 46rem) {
		.form:has(.form__poster--filled) {
			grid-template-columns: minmax(0, 1fr) minmax(0, 17rem);
			column-gap: clamp(1rem, 3vw, 1.75rem);
		}
		.form:has(.form__poster--filled) > :not(.form__poster) {
			grid-column: 1;
		}
		.form__poster--filled {
			grid-column: 2;
			grid-row: 1 / -1;
			margin: 0;
			inset-block-start: 1rem;
			align-self: start;
		}
		/* There is room here for the whole picture, its label, and the sentence about what happens
		   to it — which is the sentence somebody wants while they are still deciding to send it. */
		.form__poster--filled :global(.poster) {
			padding: 0.9rem 1rem 1rem;
		}
		.form__poster--filled :global(.poster__label),
		.form__poster--filled :global(.poster__fig figcaption) {
			display: block;
		}
		.form__poster--filled :global(.poster__fig img) {
			max-block-size: 18rem;
			object-fit: contain;
		}
	}

	/*
	 * The provenance mark.
	 *
	 * Dim and small on purpose: it is context for a value, not a warning about it. A person is
	 * checking a suggestion, and a loud badge on ten fields would read as ten problems.
	 */
	.field__from {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3em;
		margin-inline-start: 0.5em;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	/*
	 * A query container for the ways, so their headings size against this column rather than the
	 * viewport (docs/brand.md). It does NOT disturb the `@container (min-width: 46rem)` rules
	 * further down: those sit inside `.panel`, which is a nearer container than this one.
	 */
	.modes {
		display: grid;
		container-type: inline-size;
	}

	.ways {
		display: grid;
		gap: 0.75rem;
		margin-block-end: 0.75rem;
	}
	/*
	 * Two columns for the alternates, with the primary spanning both.
	 *
	 * Written as an explicit two-track grid inside a container query rather than `auto-fit`: with
	 * `auto-fit` and a 16rem minimum, a 1300px column makes four tracks, so the two alternates end
	 * up a quarter wide each with half the row empty. Below the query it is a plain single-column
	 * stack, where `grid-column: 1 / -1` is a no-op rather than an invented second column.
	 */
	@container (min-width: 40rem) {
		.ways {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.way--photo {
			grid-column: 1 / -1;
		}
	}
	.way {
		display: grid;
		gap: 0.35rem;
		justify-items: start;
		cursor: pointer;
		padding: clamp(1rem, 2.5vw, 1.5rem);
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		/*
		 * Always declared, transparent when closed. Marking the open way by *adding* a rule would
		 * reflow the whole row by 3px every time somebody switches.
		 */
		border-inline-start: var(--rule-fat) solid transparent;
	}
	.way__label {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.way__h {
		line-height: 0.85;
		font-size: clamp(1.2rem, 3cqw, 1.75rem);
	}
	.way__what {
		font-size: 0.875rem;
		color: var(--peach-dim);
		max-inline-size: 54ch;
	}
	.way__open {
		display: none;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
	}

	/* The primary: peach paper, navy ink — the same inverted band the manifesto uses. */
	.way--photo {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
		border-inline-start-color: transparent;
	}
	.way--photo .way__h {
		font-size: clamp(1.6rem, 6cqw, 2.75rem);
	}
	.way--photo .way__label,
	.way--photo .way__what {
		color: var(--navy-dim);
	}
	/*
	 * With no verifier configured the shortcut cannot work, so it stops being the loudest thing on
	 * the page — but it stays, because vanishing is what made people conclude upload did not exist.
	 * The panel behind it says why.
	 */
	.way--off {
		background: var(--navy-900);
		color: inherit;
		border-color: var(--peach-line);
	}
	.way--off .way__label,
	.way--off .way__what {
		color: var(--peach-dim);
	}
	.way--off .way__h {
		font-size: clamp(1.2rem, 3cqw, 1.75rem);
	}

	.way:hover {
		border-block-color: var(--peach);
		border-inline-end-color: var(--peach);
	}
	.way--photo:not(.way--off):hover {
		background: var(--peach-hi);
		border-block-color: var(--peach-hi);
		border-inline-end-color: var(--peach-hi);
	}

	/*
	 * CSS drives the switch, not JavaScript: all three panels are in the server-rendered HTML and
	 * the radios carry the state, so the ways work with scripting off. The `bind:group` in the
	 * script exists only so a finished extraction can flip to the form.
	 */
	#mode-lenkje:checked ~ .ways .way--link,
	#mode-skjema:checked ~ .ways .way--form,
	#mode-bilete:checked ~ .ways .way--photo.way--off {
		border-inline-start-color: var(--peach);
		background: var(--navy-700);
	}
	#mode-bilete:checked ~ .ways .way--photo {
		border-inline-start-color: var(--navy-900);
	}
	#mode-bilete:checked ~ .ways .way--photo .way__open,
	#mode-lenkje:checked ~ .ways .way--link .way__open,
	#mode-skjema:checked ~ .ways .way--form .way__open {
		display: block;
	}
	#mode-skjema:focus-visible ~ .ways .way--form,
	#mode-lenkje:focus-visible ~ .ways .way--link,
	#mode-bilete:focus-visible ~ .ways .way--photo.way--off {
		outline: var(--rule-fat) solid var(--peach-hi);
		outline-offset: 3px;
	}
	/* peach-hi on a peach ground is invisible; navy is the readable ring on the inverted card. */
	#mode-bilete:focus-visible ~ .ways .way--photo {
		outline: var(--rule-fat) solid var(--navy-900);
		outline-offset: 3px;
	}
	/*
	 * The query container for both panels.
	 *
	 * On the wrapper, not on `.form` or `.capture` themselves: an element cannot match a container
	 * query against its own size, so a `container-type` declared on the thing being queried does
	 * nothing at all — silently, which is the trap.
	 */
	.panel {
		container-type: inline-size;
	}

	/*
	 * Each tab hides the two panels that are not its own.
	 *
	 * Written out rather than "hide every panel, then show the checked one": a `:not()` chain here
	 * would put the default state at the mercy of specificity, and with no radio checked at all —
	 * which is what a browser does after a back-forward restore — the form panel must still be the
	 * one on screen.
	 */
	#mode-skjema:checked ~ .panel--photo,
	#mode-skjema:checked ~ .panel--link,
	#mode-bilete:checked ~ .panel--form,
	#mode-bilete:checked ~ .panel--link,
	#mode-lenkje:checked ~ .panel--form,
	#mode-lenkje:checked ~ .panel--photo {
		display: none;
	}
	.form {
		display: grid;
	}
	.form__intro:focus {
		outline: none; /* focused programmatically after an extraction, not by the user */
	}
	.form__intro {
		padding: clamp(1rem, 3vw, 1.75rem);
		display: grid;
		gap: 0.5rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.form__read,
	.form__from,
	.form__unread {
		margin: 0;
		max-inline-size: 60ch;
	}
	.form__from {
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
	.form__unread {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: var(--peach-hi);
	}
	/*
	 * What stopped it last time, at the top of the form it is being corrected in.
	 *
	 * Same list /kø renders, deliberately: somebody arriving here clicked through that page, and a
	 * second summary in different words would read as a second, different problem.
	 */
	.form__fix {
		display: grid;
		gap: 0.5rem;
		border: var(--rule) solid var(--peach-line);
		padding: clamp(0.75rem, 2vw, 1rem);
	}
	.form__fix-lede {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-hi);
		max-inline-size: 60ch;
	}
	.form__fix-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.form__fix-list li {
		display: grid;
		gap: 0.15rem;
		max-inline-size: 60ch;
	}
	.form__fix-name,
	.form__fix-verdict {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.form__fix-verdict {
		color: var(--peach-dim);
	}
	.form__fix-why {
		font-size: 0.875rem;
	}
	.form__fix-hint {
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.group {
		border: 0;
		border-block-end: var(--rule) solid var(--peach-line);
		margin: 0;
		padding: clamp(1rem, 3vw, 1.75rem);
		min-inline-size: 0;
	}
	/* The footer already draws a rule; a second one here reads as a 2px seam. */
	.group:last-of-type {
		border-block-end: 0;
	}
	.group__legend {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		padding: 0;
	}
	.group__hint {
		margin: 0.15rem 0 0.9rem;
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 60ch;
	}
	.grid {
		display: grid;
		/* auto-fit, not span-2 tricks: a single-column grid with `grid-column: span 2` invents a
		   second implicit column and doubles the page width at 320px. */
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 1.1rem 1.5rem;
	}
	.field {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		min-inline-size: 0;
	}
	.field--wide {
		grid-column: 1 / -1;
	}
	label {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.field__opt {
		text-transform: none;
		letter-spacing: 0.04em;
		opacity: 0.75;
	}
	.field__hint {
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 60ch;
	}
	.field__error {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-hi);
	}
	/*
	 * The reason a field is being asked about, at the field.
	 *
	 * A block rather than an inline mark like `.field__from`: this is a sentence from the check,
	 * not a four-word provenance label, and inline it pushed every marked label onto two lines.
	 * `--peach-hi` is the same colour `.field__error` uses, because to the person correcting the
	 * form these are the same kind of thing — something to change before sending again.
	 */
	.field__fix {
		display: block;
		font-size: 0.8125rem;
		color: var(--peach-hi);
		max-inline-size: 60ch;
		border-inline-start: var(--rule) solid var(--peach-line);
		padding-inline-start: 0.6em;
	}
	.field__fix-name {
		display: block;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	/*
	 * Scoped to .field, not bare `input`/`select`/`textarea`.
	 *
	 * Svelte scoping rewrites a bare element selector to `input.svelte-hash`, which is
	 * specificity (0,1,1) — higher than the shared `.visually-hidden` utility at (0,1,0). So a
	 * component rule on an element type silently overrides brand.css. Here that gave the hidden
	 * mode radios `inline-size: 100%`, and two absolutely-positioned 320px-wide inputs pushed the
	 * page 25px past the viewport at 320px. Selecting on the wrapper avoids the whole class of bug.
	 */
	.field input,
	.field select,
	.field textarea {
		inline-size: 100%;
		min-inline-size: 0;
		font: inherit;
		font-size: 1rem; /* below 16px, iOS Safari zooms the page on focus */
		color: var(--peach-hi);
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		padding: 0.7em 0.8em;
	}
	.field textarea {
		resize: vertical;
	}
	.field input:focus-visible,
	.field select:focus-visible,
	.field textarea:focus-visible {
		outline: 2px solid var(--peach);
		outline-offset: 2px;
	}
	.field input[aria-invalid='true'],
	.field select[aria-invalid='true'],
	.field textarea[aria-invalid='true'] {
		border-color: var(--peach);
		border-inline-start-width: var(--rule-fat);
	}
	/*
	 * Recurrence, as one framed question inside "Når" rather than a fieldset of its own.
	 *
	 * A frame and not a bare row: it is a branch in the form, and everything that appears when the
	 * answer is yes has to read as belonging to the question rather than as more "when" fields.
	 */
	.repeat {
		border: var(--rule) solid var(--peach-line);
		background: var(--navy-900);
		margin: 0;
		padding: 0.9rem 1rem 1.1rem;
		min-inline-size: 0;
	}
	.repeat__legend {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--peach-dim);
		padding: 0;
	}
	.repeat__hint {
		margin: 0.15rem 0 0.8rem;
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 60ch;
	}
	.repeat__grid {
		display: grid;
		/* Same auto-fit shape as `.grid`: a single-column track with `span 2` invents a second
		   implicit column and doubles the page width at 320px. */
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 1.1rem 1.5rem;
	}
	.days {
		border: 0;
		margin: 0;
		padding: 0;
		min-inline-size: 0;
	}
	.days legend {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
		padding: 0;
		margin-block-end: 0.35rem;
	}
	.days__row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.day {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		border: var(--rule) solid var(--peach-line);
		padding: 0.5em 0.7em;
		cursor: pointer;
	}
	.day:has(input:checked) {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.day:has(input:focus-visible) {
		outline: 2px solid var(--peach);
		outline-offset: 2px;
	}
	.day input {
		/* The label carries the visual state; the box only needs to stay operable and focusable. */
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: pointer;
	}
	.repeat__echo {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-hi);
	}
	.form__send {
		position: sticky;
		inset-block-end: 0;
		z-index: 1;
		padding: clamp(0.85rem, 2.5vw, 1.25rem) clamp(1rem, 3vw, 1.75rem);
		border-block-start: var(--rule) solid var(--peach-line);
		/* Solid, not transparent: the fields scroll underneath it and the halftone would show
		   straight through a see-through bar. */
		background: var(--navy-900);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1.25rem;
	}
	.form__send-note {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.form__foot {
		padding: clamp(1rem, 3vw, 1.75rem);
		display: grid;
		justify-items: start;
	}
	.form__fine {
		margin: 0;
		max-inline-size: 58ch;
	}
</style>
