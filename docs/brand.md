# Brand

A duotone poster system. Gig-poster and fanzine energy, because that is what local concert listings
actually look like — and because a grassroots culture platform should not look like enterprise SaaS.

## The two colours, and only two

| Token        | Value     | Use                                   |
| ------------ | --------- | ------------------------------------- |
| `--navy-900` | `#16223b` | Deepest — panels, footer, badge fills |
| `--navy-800` | `#1e2c4a` | Page base                             |
| `--navy-700` | `#26375c` | Raised surfaces                       |
| `--navy-600` | `#2f4470` | Hairlines on navy                     |
| `--peach`    | `#f7a98a` | Primary ink                           |
| `--peach-hi` | `#ffbb99` | Emphasis, focus rings                 |

Tints of the same two hues are fine. **A third hue is not**, and adding one needs a decision record.
Everything lives in `app/src/lib/styles/brand.css` — one source of truth, no colour literals in
components.

### Alpha tokens are the trap

Composited alpha is where a duotone quietly fails. Measured, not guessed:

| Token               | Effective ratio   | Allowed for                                   |
| ------------------- | ----------------- | --------------------------------------------- |
| `--peach-dim` 82%   | 4.51:1 worst case | **Text.** De-emphasised body and labels       |
| `--peach-quiet` 52% | 3.08:1            | Large display numerals only — never body text |
| `--peach-line` 30%  | 1.87:1            | Hairlines. **Never text**                     |
| `--peach-ghost` 8%  | 1.16:1            | Fills and the halftone field only             |

`--peach-dim` started at 55%, which looked correct and measured **3.21:1** — a straight AA failure,
and it was being used for the "does not" descriptions and the verification-pipeline copy. Raised to
82%, the floor that clears 4.5:1 against the _worst_ of our three navies. Don't lower it because a
mock looks nicer.

Worst case means `navy-700`, not the page background — always check a token against the lightest
surface it can land on, not the one in the design you happen to be looking at.

### Contrast is measured, not eyeballed

| Pair                                        | Ratio      |               |
| ------------------------------------------- | ---------- | ------------- |
| `--peach` on `--navy-800`                   | **7.26:1** | AAA body text |
| `--peach-hi` on `--navy-800`                | **8.47:1** | AAA           |
| `--navy-900` on `--peach` (inverted blocks) | **9.09:1** | AAA           |

The reference palette we took this from sat at 6.17:1 — already AA. Dropping the navy slightly
bought AAA at no cost to the look. **If you introduce a new pairing, measure it.** The README
commits this project to accessibility, and peach-on-navy is exactly the family of palettes that
quietly fails.

## Type

**Archivo Variable** — `wght 100–900`, `wdth 62%–125%`. The look is maximum weight at maximum
width: `font-weight: 900; font-stretch: 125%`. Italic is the slant, used sparingly as counterpoint.
Outline type (`-webkit-text-stroke`) plays against the solid mass; there is a `@supports` fallback
to solid so it can never render invisible.

**Space Mono** for micro-labels, metadata and body copy — the letterspaced uppercase label at
`0.28em` is the connective tissue of the whole system.

Both are **self-hosted via Fontsource**, not Google Fonts. A project whose pitch is privacy should
not leak visitor IPs to a third party for a typeface.

### Sizing against the container, not the viewport

Display type is sized in `cqw` (container query units), not `vw`. This was learned the hard way: the
hero headline at `19vw` overflowed its column badly on desktop while looking fine on mobile, because
the column is far narrower than the screen. `ch` units don't constrain an expanded face either.

## Poster vocabulary

Borrowed deliberately, each with a job:

- **Segmented pips** (`.pips`) — roadmap phase, as a progress indicator
- **Hairline frames and rules** — structure without boxes-in-boxes
- **Inverted bands** (`.invert`) — peach paper, navy ink, for manifesto moments
- **Halftone** — a dot field whose dot _size_ falls off from a centre, as a real screen does. Built
  from layered SVG patterns with radial-gradient masks. No images, no bitmap, scales cleanly.
- **Outline display type**, ovals, four-point sparkles

## The one hard rule about rotation

Rotated text is for **decorative labels only**. Never rotate text a visitor must read to understand
the page.

The reference art rotates a full paragraph of body copy 90°. It looks great and it is an
accessibility failure — hostile to low vision, to magnification, and to anyone reading on a phone.
We take the visual language and leave that part. `.label--vertical` exists for short decorative
strings; content stays upright.

Same principle elsewhere: `prefers-reduced-motion` is honoured, focus rings are a visible 3px
`--peach-hi`, and the halftone never sits behind text without a solid backing.
