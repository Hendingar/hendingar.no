# Evals

Two suites, one runner each, both scored against the live model:

| Suite          | Asks                                     | Cases              | Command                       |
| -------------- | ---------------------------------------- | ------------------ | ----------------------------- |
| **Extraction** | did the model read the poster?           | `cases/<slug>/`    | `pnpm verifier:eval`          |
| **Pipeline**   | did the checks reach the right decision? | `pipeline/<slug>/` | `pnpm verifier:eval:pipeline` |

The scoring vocabulary is shared — `matchers.py` — so the two cannot disagree about what `oneOf`
means.

## Extraction evals

Real images with hand-written ground truth, scored against the live model.

**These are not tests.** `pytest` must stay hermetic (CLAUDE.md rule 6): no network, no Azure, no
non-determinism. These call the actual deployment, cost tokens, and can fail because a model
changed rather than because the code did. So they live here, run on demand, and are never part of
`pnpm verify` or CI's required checks.

```bash
pnpm verifier:eval              # every case
pnpm verifier:eval komle        # cases whose name contains "komle"
```

Requires the same environment as running the service (`services/verifier/.env`) and an `az login`
with `Cognitive Services OpenAI User` on the account.

## Adding a case

```
evals/cases/<slug>/image.jpg        the input, downscaled to 1600px longest edge as the browser does
evals/cases/<slug>/expected.json    ground truth
```

Downscale when you add it, so the eval sees what production sees rather than a pristine original:

```bash
sips -Z 1600 -s format jpeg -s formatOptions 82 original.png --out evals/cases/<slug>/image.jpg
```

`expected.json` holds `today` (so relative dates like "laurdag 14." resolve deterministically) and
an `expect` map of field → matcher:

| Matcher    | Passes when                                  |
| ---------- | -------------------------------------------- |
| `equals`   | exact match (case-insensitive for strings)   |
| `contains` | substring, case-insensitive                  |
| `oneOf`    | value is in the list                         |
| `isNull`   | field is null (`true`) or not null (`false`) |
| `atLeast`  | numeric ≥                                    |
| `atMost`   | numeric ≤                                    |

Assert only what the image actually states. A field the poster omits should be asserted
`{"isNull": true}` — that is the assertion that catches invention, which is the failure mode that
matters most here. A model that guesses a plausible venue is worse than one that leaves it blank,
because a blank field asks the submitter for help and a guess does not.

## Negative cases belong here too

At least one case must be an image with no event in it. Extraction quality is not only "did it read
the poster" but "did it refuse when there was nothing to read".

## Pipeline evals

`pipeline/<slug>/case.json` — an event already in our shape, and what the checks should decide
about it. No image: extraction has already happened, or somebody typed the form.

```bash
pnpm verifier:eval:pipeline             # every case
pnpm verifier:eval:pipeline bergen     # cases whose name contains "bergen"
```

```json
{
	"description": "why this case exists, and what it would catch",
	"source": "where it came from — a real submission, ideally",
	"request": {
		"title": "The Watch spelar Genesis",
		"category": "musikk",
		"starts_at": "+120d",
		"venue_name": "Grieghallen",
		"municipality": "Bergen"
	},
	"expect": {
		"recommendation": { "equals": "reject" },
		"check.coverage.verdict": { "equals": "fail" },
		"summary": { "contains": "Bergen" }
	}
}
```

`request` is a `VerifyRequest`. `expect` uses the same matchers as above, over three roots:

- `recommendation` and `summary` — the pipeline's answer
- `check.<name>.<field>` — one check by name, never by position. `checks` is a list whose order is
  an implementation detail of `verify()`, and a case asserting `checks.3.verdict` would break the
  day a check is inserted.

**Times are offsets, not dates.** `starts_at: "+120d"` resolves at run time. `normalisation` asks
whether an event is in the future, so a case written with a literal date is a case that starts
failing for the wrong reason on a day nobody chose. `+Nd`, `-Nd`, `+Nh` all work; anything else is
passed through as a literal.

### What a case should be

The corpus is the record of what has actually gone wrong. `bergen-grieghallen` is submission 880 —
a real concert in Grieghallen that passed all five checks and was published, because none of them
asked where it was.

A rule that refuses events needs cases in **both** directions, and the second direction is the one
worth the effort: refusing Bergen is easy, and refusing Leirvik is the failure that costs a real
person their event. So `leirvik-utan-kommune`, `ingen-stad-oppgitt` and `vestland-er-ikkje-eit-svar`
are all here to assert that the pipeline asks instead of refusing, and `spam-fra-rett-kommune` is
here because coverage must not become the only check that stops anything.

### These cases are partly covered by `pytest`

`tests/test_eval_cases.py` loads every case offline: it validates the request, checks that each
assertion names a field that exists, and **runs the expectations that are about deterministic
checks** — `coverage`, `normalisation`, `duplicate` and `corroboration` reach the same verdict with
no model at all.

That is deliberate. It means the Bergen concert is a failing test on every commit rather than a
note in a directory somebody remembers to run, while the parts that genuinely need a model —
whether a confident plausibility pass can outrank a rule — stay here, where they cost tokens and
can fail because a model changed.
