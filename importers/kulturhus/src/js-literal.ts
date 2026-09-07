/**
 * Reading a JavaScript object literal that is not JSON.
 *
 * Bømlo kulturhus runs an older Gatsby than Stord does. Stord serves its page data as
 * `/page-data/kulturprogram/page-data.json` — actual JSON, `JSON.parse` and done. Bømlo serves the
 * same data as a webpack chunk:
 *
 * ```js
 * webpackJsonp([0xc5d…],{1030:function(e,t){e.exports={pathContext:{blocks:[…]}}}});
 * ```
 *
 * The payload inside is an object *literal*, and a literal is not JSON: keys are unquoted, some
 * strings are single-quoted, and `false` and `true` are minified to `!1` and `!0`. `JSON.parse`
 * rejects it at character two.
 *
 * **This reads it. It does not run it.** No `eval`, no `new Function`, no `vm` — the file comes
 * from a third party over the network, and a data format is not a reason to execute somebody
 * else's code inside a process holding a database connection. So this is a recursive-descent
 * reader over the small grammar that actually appears: objects, arrays, strings, numbers, `null`,
 * `true`/`false` and their minified forms.
 *
 * It is deliberately strict. Anything outside that grammar — a function, a template literal, an
 * arrow, an array hole — throws rather than being skipped, because a reader that quietly returns
 * *part* of a programme is indistinguishable from a venue that cancelled half its events. The
 * committed fixture is 29KB of real chunk and includes the awkward parts: HTML and CSS blobs held
 * in single-quoted strings, apostrophes inside double-quoted Nynorsk, and 79 minified booleans.
 *
 * Same argument as `packages/core/src/ical.ts`: a hand-written reader for a small grammar whose
 * failure modes are all in the escaping, tested against the real thing.
 */

/** Anything the grammar does not cover, named with where it was found. */
export class JsLiteralError extends Error {}

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

class Reader {
	private i = 0;
	/*
	 * Assigned in the body, not declared as a parameter property.
	 *
	 * `constructor(private readonly source: string)` typechecks and passes vitest, and then throws
	 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` the first time the importer actually runs: the ingest
	 * entry point is `node --experimental-strip-types`, which erases types without rewriting code
	 * and so cannot synthesise the assignment a parameter property implies. Nothing in
	 * `pnpm verify` executes the CLI, so this shape is invisible until the scheduled run fails.
	 */
	private readonly source: string;

	constructor(source: string) {
		this.source = source;
	}

	/** Where parsing stopped, for an error message that can be acted on. */
	private context(): string {
		const from = Math.max(0, this.i - 40);
		return `at ${this.i}: …${this.source.slice(from, this.i + 40)}…`;
	}

	private fail(what: string): never {
		throw new JsLiteralError(`${what} ${this.context()}`);
	}

	private skipSpace(): void {
		while (this.i < this.source.length && /\s/.test(this.source[this.i]!)) this.i += 1;
	}

	private peek(): string {
		this.skipSpace();
		return this.source[this.i] ?? '';
	}

	private eat(char: string): void {
		if (this.peek() !== char) this.fail(`expected ${char}`);
		this.i += 1;
	}

	/** Read one value, and report where it ended so a caller can tell literal from trailing code. */
	static read(source: string, start: number): { value: unknown; end: number } {
		const reader = new Reader(source);
		reader.i = start;
		const value = reader.value();
		reader.skipSpace();
		return { value, end: reader.i };
	}

	private value(): unknown {
		const char = this.peek();
		if (char === '{') return this.object();
		if (char === '[') return this.array();
		if (char === '"' || char === "'") return this.string();
		if (char === '!') return this.minifiedBoolean();
		if (char === '-' || DIGIT.test(char)) return this.number();
		if (IDENTIFIER_START.test(char)) return this.word();
		this.fail('not a value');
	}

	private object(): Record<string, unknown> {
		this.eat('{');
		const out: Record<string, unknown> = {};
		if (this.peek() === '}') {
			this.i += 1;
			return out;
		}
		for (;;) {
			const key = this.key();
			this.eat(':');
			out[key] = this.value();
			const next = this.peek();
			if (next === ',') {
				this.i += 1;
				// `{a:1,}` is legal JavaScript. Accepted here so a minifier's output is not a bug.
				if (this.peek() === '}') {
					this.i += 1;
					return out;
				}
				continue;
			}
			if (next === '}') {
				this.i += 1;
				return out;
			}
			this.fail('expected , or } in object');
		}
	}

	/** `title`, `"title"` or `'title'`. Numeric keys appear in webpack output and are stringified. */
	private key(): string {
		const char = this.peek();
		if (char === '"' || char === "'") return this.string();
		if (DIGIT.test(char)) return String(this.number());
		if (!IDENTIFIER_START.test(char)) this.fail('not a key');
		const from = this.i;
		this.i += 1;
		while (this.i < this.source.length && IDENTIFIER_PART.test(this.source[this.i]!)) this.i += 1;
		return this.source.slice(from, this.i);
	}

	private array(): unknown[] {
		this.eat('[');
		const out: unknown[] = [];
		if (this.peek() === ']') {
			this.i += 1;
			return out;
		}
		for (;;) {
			/*
			 * An elision — `[1,,2]` — is a hole, and JavaScript reads it as `undefined`. Refused
			 * rather than filled in: webpack emits holes in its *module* array, so meeting one
			 * inside a data literal means this is not the literal we think it is, and guessing
			 * would put a phantom event in the list.
			 */
			if (this.peek() === ',') this.fail('array hole');
			out.push(this.value());
			const next = this.peek();
			if (next === ',') {
				this.i += 1;
				if (this.peek() === ']') {
					this.i += 1;
					return out;
				}
				continue;
			}
			if (next === ']') {
				this.i += 1;
				return out;
			}
			this.fail('expected , or ] in array');
		}
	}

	/**
	 * A quoted string, in either quote style.
	 *
	 * The escapes are the part that matters, and the part a regex would get wrong: the fixture
	 * holds `<style>` blocks in single-quoted strings with double quotes inside them, and Nynorsk
	 * apostrophes inside double-quoted ones. Tracking the opening quote is what makes both safe.
	 */
	private string(): string {
		const quote = this.peek();
		this.i += 1;
		let out = '';
		while (this.i < this.source.length) {
			const char = this.source[this.i]!;
			if (char === '\\') {
				const escape = this.source[this.i + 1];
				this.i += 2;
				switch (escape) {
					case 'n':
						out += '\n';
						break;
					case 'r':
						out += '\r';
						break;
					case 't':
						out += '\t';
						break;
					case 'b':
						out += '\b';
						break;
					case 'f':
						out += '\f';
						break;
					case 'v':
						out += '\v';
						break;
					case '0':
						out += '\0';
						break;
					case 'u': {
						// `\u{1f600}` as well as `\uXXXX`; both appear in minified output.
						if (this.source[this.i] === '{') {
							const close = this.source.indexOf('}', this.i);
							if (close === -1) this.fail('unterminated \\u{…}');
							const code = Number.parseInt(this.source.slice(this.i + 1, close), 16);
							if (Number.isNaN(code)) this.fail('bad \\u{…}');
							out += String.fromCodePoint(code);
							this.i = close + 1;
						} else {
							const code = Number.parseInt(this.source.slice(this.i, this.i + 4), 16);
							if (Number.isNaN(code)) this.fail('bad \\u escape');
							out += String.fromCharCode(code);
							this.i += 4;
						}
						break;
					}
					case 'x': {
						const code = Number.parseInt(this.source.slice(this.i, this.i + 2), 16);
						if (Number.isNaN(code)) this.fail('bad \\x escape');
						out += String.fromCharCode(code);
						this.i += 2;
						break;
					}
					case '\n':
						// A line continuation contributes nothing to the value.
						break;
					case undefined:
						this.fail('unterminated string');
					default:
						// `\'`, `\"`, `\\`, `\/` and anything else stand for themselves.
						out += escape;
				}
				continue;
			}
			if (char === quote) {
				this.i += 1;
				return out;
			}
			out += char;
			this.i += 1;
		}
		this.fail('unterminated string');
	}

	/** `!0` is `true` and `!1` is `false`. Every minifier writes booleans this way. */
	private minifiedBoolean(): boolean {
		this.i += 1;
		const digit = this.source[this.i];
		if (digit === '0') {
			this.i += 1;
			return true;
		}
		if (digit === '1') {
			this.i += 1;
			return false;
		}
		this.fail('expected !0 or !1');
	}

	private number(): number {
		const from = this.i;
		if (this.source[this.i] === '-') this.i += 1;
		// Hex, because webpack writes chunk ids that way. Decimals and exponents for data.
		if (this.source[this.i] === '0' && /[xX]/.test(this.source[this.i + 1] ?? '')) {
			this.i += 2;
			while (this.i < this.source.length && /[0-9a-fA-F]/.test(this.source[this.i]!)) this.i += 1;
		} else {
			while (this.i < this.source.length && /[0-9.eE+-]/.test(this.source[this.i]!)) this.i += 1;
		}
		const raw = this.source.slice(from, this.i);
		const value = Number(raw);
		if (Number.isNaN(value)) this.fail(`bad number ${raw}`);
		return value;
	}

	/** The only bare words the grammar allows. A `function` lands here and is refused. */
	private word(): null | boolean {
		const from = this.i;
		while (this.i < this.source.length && IDENTIFIER_PART.test(this.source[this.i]!)) this.i += 1;
		const word = this.source.slice(from, this.i);
		if (word === 'null') return null;
		if (word === 'true') return true;
		if (word === 'false') return false;
		this.i = from;
		this.fail(`unsupported token ${word}`);
	}
}

/**
 * Read the object literal a webpack module assigns to `e.exports`.
 *
 * Anchored on the assignment rather than on the first `{` in the file: the chunk opens with
 * `webpackJsonp([id],{1030:function(e,t){…`, so the first brace belongs to webpack's module map
 * and the second to a function body. `e.exports=` is the one landmark that names the payload.
 *
 * The variable is whatever the minifier chose, so the pattern allows any identifier before
 * `.exports`. Throws if there is no such assignment, or if what follows is not a literal this
 * reader covers.
 */
export function readWebpackModuleExports(chunk: string): unknown {
	const assignment = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.exports\s*=\s*(?=\{)/.exec(chunk);
	if (!assignment) {
		throw new JsLiteralError('no `<var>.exports = {…}` assignment in the chunk');
	}
	const { value } = Reader.read(chunk, assignment.index + assignment[0].length);
	return value;
}

/** Read one object literal starting at `start`. Exported for the tests, which is where the
 *  awkward cases live. */
export function readJsLiteral(source: string, start = 0): unknown {
	return Reader.read(source, start).value;
}
