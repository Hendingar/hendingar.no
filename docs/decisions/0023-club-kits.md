# 0023 — A home match wears its club's colours

**Status:** accepted (2026-10-13)
**Amends:** [docs/brand.md](../brand.md) — "a third hue is not" now has one scoped exception

## Context

The brand is a duotone, navy and peach, and `docs/brand.md` says a third hue needs a decision
record. The football cards were the first place that rule cost something: every match was the
same peach-on-navy title card, and a Bremnes home game looked nothing like Bremnes. Clubs are
recognised by their colours before their names. Bremnes plays in yellow and black, Stord in black
and white.

## Decision

**The card of a home match is drawn in the home club's colours, for clubs we have written down.**

- A kit is a class in `brand.css` (`.kit--bremnes`, `.kit--stord`) that re-points `--navy-*` and
  `--peach-*` on one element. It adds no new token names, so nothing inside the card knows kits
  exist. The versus tile, time chip, title, frame and heart all follow without changes.
- `app/src/lib/club-kits.ts` picks the kit from the fixture's home club, the way the crest table
  picks a crest. Every fixture we import is a home match, so the home club owns the card.
- A kit sets the same roles at the same alphas, and each is measured on its own grounds. Every
  ratio is above the navy-and-peach figure it replaces (the numbers are in `brand.css`).
- Scope: the event's card and its versus tile. It never reaches the page, the masthead or anything
  that is not about that match.

## Consequences

- The palette is no longer strictly two hues. It is still two per card, which is the part of the
  duotone that carries the look.
- No token on `:root` may be defined in terms of another. One that was would be resolved at
  `:root` and ignore the kit.
- Adding a club means one line in `club-kits.ts`, a `.kit--<slug>` block with its ratios measured,
  and a pair of colours the club actually plays in.

## How we'd know we were wrong

The listing reads as a patchwork rather than a poster wall, or a club asks us not to use its
colours. Either way the remedy is deleting entries, and every card falls back to navy and peach.
