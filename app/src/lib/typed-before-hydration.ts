/**
 * What somebody typed into the server-rendered form before the JavaScript arrived.
 *
 * A remote form is real HTML: `/send-inn` posts and renders a verdict with scripting off, which is
 * the whole point of ADR 0002 and of the spec that asserts the form exists in the server-rendered
 * markup. So the fields are usable from the moment the HTML lands — seconds before the entry
 * chunks have been fetched, parsed and hydrated on a phone, and tens to hundreds of milliseconds
 * before it on anything else.
 *
 * Hydration then spreads the form's field state back over every input: `{...f.title.as('text')}`
 * carries a `value`, and that value is the empty string, because nothing has told the state what
 * is already in the box. Everything typed in the gap is silently erased — no error, no hint, just
 * an empty field and, for a required one, a submit that the browser refuses to send.
 *
 * That is a real bug for a real visitor, and it is also what four different e2e specs kept failing
 * on: Playwright types the instant `page.goto` resolves, which is the `load` event, which is
 * strictly *before* hydration — SvelteKit hydrates from a dynamic `import()` inside an inline
 * module script, so there is always a gap. Under load it grew from ~20ms to ~120ms and the fills
 * landed inside it; the click then hit an empty required `#title`, the browser blocked the submit,
 * no request was ever made, and the spec sat waiting for a verdict that nothing had asked for.
 * Measured: `title/date/startTime/venueName` all reset to `''` 120ms after `goto` returned.
 *
 * Read on the first call and only the first call. Call it from the `<script>` of the component
 * that owns the form: a component's script runs before its own template is hydrated, so that is
 * the last moment at which the DOM still holds what the person typed — and every millisecond
 * earlier is another millisecond of typing that the snapshot would miss. Taking it at module
 * evaluation instead left exactly that gap, and a spec still lost its title to it.
 *
 * Once is what keeps it honest: a later client-side navigation adopts nothing, rather than reading
 * whatever happens to still be in the DOM of the page being navigated away from.
 */

let claimed = false;

/** Values by element id. Empty on the server, where there is no document. */
function capture(): Map<string, string> {
	const values = new Map<string, string>();
	if (typeof document === 'undefined') return values;

	const selector = 'form input[id], form select[id], form textarea[id]';
	for (const element of document.querySelectorAll(selector)) {
		const value = typedValueOf(element);
		if (value !== null && value !== '') values.set(element.id, value);
	}

	return values;
}

/** The text a control holds, or null for one that holds no text a person can have typed. */
function typedValueOf(element: Element): string | null {
	if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
		return element.value;
	}
	if (element instanceof HTMLInputElement) {
		// A radio or a checkbox says what it means through `checked`; its `value` is a constant
		// label, and adopting it would read as "the person typed this" when they had not.
		return element.type === 'radio' || element.type === 'checkbox' ? null : element.value;
	}
	return null;
}

/**
 * The pre-hydration values, once.
 *
 * Every later call answers with an empty map, so this can only ever restore the document the
 * server actually rendered — never a stale field from a page being navigated away from.
 */
export function claimTypedBeforeHydration(): Map<string, string> {
	if (claimed) return new Map();
	claimed = true;
	return capture();
}
