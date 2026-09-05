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

### The density wash, and its ceiling

The calendar shows how busy a day is as an _area_ as well as a number, so a month can be read at a
glance instead of square by square. That is four steps of peach over navy:

| Token            | Alpha | Peach on it, over `--navy-800` | over `--navy-700` |
| ---------------- | ----- | ------------------------------ | ----------------- |
| `--peach-wash-1` | 6%    | 6.49:1                         | 5.53:1            |
| `--peach-wash-2` | 12%   | 5.74:1                         | 4.93:1            |
| `--peach-wash-3` | 18%   | 5.05:1                         | **4.38:1** ✗      |
| `--peach-wash-4` | 22%   | **4.63:1**                     | **4.04:1** ✗      |

Two rules come out of that table, and both are load-bearing:

**22% is the top step**, because 4.63:1 is what is left of AA there. The mock reached for 38%, which
measures **3.25:1** — the same failure `--peach-dim` had at 55%, arrived at the same way. Anything
that must read as _more_ than the top step inverts instead (`--navy-900` on `--peach`, 8.29:1).
That is why the busiest days in the month grid carry a filled count chip rather than a darker square.

**The wash is for the page ground only.** Unlike every other token here it does _not_ survive the
worst-case check against `--navy-700`: the top two steps fail there. A component using it must sit
on `--navy-800`. If a washed thing ever needs to go inside a raised panel, the scale has to be
re-measured against that surface, not assumed.

A wash is never the only signal. The month grid states the same count three ways — the numeral, the
wash, and a row of pips — because colour alone fails WCAG 1.4.1, and because adjacent steps of a
four-step scale are not distinguishable in isolation however well they measure.

`--navy-dim` (78%) is the mirror token for de-emphasised ink on a peach ground, and has the same
history: 65% measured 3.83:1 and failed, 78% measures 5.23:1.

Worst case means `navy-700`, not the page background — always check a token against the lightest
surface it can land on, not the one in the design you happen to be looking at.

### Contrast is measured, not eyeballed

| Pair                                        | Ratio      |               |
| ------------------------------------------- | ---------- | ------------- |
| `--peach` on `--navy-800`                   | **7.26:1** | AAA body text |
| `--peach-hi` on `--navy-800`                | **8.47:1** | AAA           |
| `--navy-900` on `--peach` (inverted blocks) | **8.29:1** | AAA           |

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

Both are **self-hosted via Fontsource**, not Google Fonts. A typeface is not worth disclosing every
visitor's IP to Google, and Google Fonts hotlinking has a GDPR history. The site does report page
views to one analytics collector — that is a deliberate, single, written-down exception, not licence
to hotline an asset host per font.

### Sizing against the container, not the viewport

Display type is sized in `cqw` (container query units), not `vw`, and there is deliberately **no
shared `--step-huge`/`--step-big` token** — each display element declares its own size against its
own container, which must therefore carry `container-type: inline-size`.

This was learned twice. First the hero headline at `19vw` overflowed its column on desktop while
looking fine on mobile. Then, after only the hero was converted, the remaining `vw` steps clipped
the CTA heading and the `/hendingar` title at 320px — the same bug at the other end of the range.
`ch` units don't constrain an expanded face either.

Two guards now exist so it cannot silently return:

- `.display` carries `overflow-wrap: anywhere` — **not** `break-word`. Only `anywhere` is counted
  when a grid or flex track computes its min-content width; with `break-word` the track stays as
  wide as the longest unbreakable run and the page scrolls sideways regardless. At 125% width a capital glyph advances ~0.92em,
  so a 12-character Norwegian compound inks ~340px inside a 280px column. An ugly break is
  strictly better than text escaping the viewport, which is a WCAG 1.4.10 failure.
- An e2e test asserts zero horizontal overflow at 320px on both pages.

### Hover and focus pairings

| Pair                                             | Ratio  |
| ------------------------------------------------ | ------ |
| `.btn:hover` — navy-900 on peach-hi              | 9.67:1 |
| focus ring — peach-hi on navy-800                | 8.47:1 |
| focus ring on inverted bands — navy-900 on peach | 8.29:1 |

## Poster vocabulary

Borrowed deliberately, each with a job:

- **Segmented pips** (`.pips`) — roadmap phase, as a progress indicator
- **Hairline frames and rules** — structure without boxes-in-boxes
- **Inverted bands** (`.invert`) — peach paper, navy ink, for manifesto moments
- **Halftone** — a dot field whose dot _size_ falls off from a centre, as a real screen does. Built
  from layered SVG patterns with radial-gradient masks. No images, no bitmap, scales cleanly.
- **Outline display type**, ovals, four-point sparkles

### The card is the poster, and it stays the poster

Tapping a card does not replace one page with another: the card's poster and its title carry
across and become the event page's. Both sides declare a `view-transition-name` derived from the
event id, so the browser matches them and morphs rather than cross-fading — the machinery is in
`brand.css` under `.vt-morph`, and the reasoning for every part of it is written there.

Two constraints worth knowing before touching it. The name must be **unique in the document**: two
elements sharing one makes the browser abandon the whole transition, every morph on the page, with
nothing logged — which is why an e2e spec asserts uniqueness against a real listing. And it is
timed to `--dur-base`, the same 240ms as the cross-fade it replaces. A poster should land, not
travel; a slower or springier morph reads as the page being dragged about, which is the same
mistake as rotating body copy.

## The one hard rule about rotation

Rotated text is for **decorative labels only**. Never rotate text a visitor must read to understand
the page.

The reference art rotates a full paragraph of body copy 90°. It looks great and it is an
accessibility failure — hostile to low vision, to magnification, and to anyone reading on a phone.
We take the visual language and leave that part. `.label--vertical` exists for short decorative
strings; content stays upright.

Same principle elsewhere: `prefers-reduced-motion` is honoured, focus rings are a visible 3px
`--peach-hi`, and the halftone never sits behind text without a solid backing.
