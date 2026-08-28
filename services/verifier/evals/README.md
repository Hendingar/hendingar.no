# Extraction evals

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
