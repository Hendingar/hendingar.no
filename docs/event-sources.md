# Proposing an event source

hendingar.no grows in two ways: people submit individual events, and we import from places that
already collect them — local newspaper calendars, municipal _kva skjer_ pages, venue sites,
festival programmes.

The second is how a new region goes from empty to useful overnight. If you know a site like that,
[open a source request](https://github.com/Hendingar/hendingar.no/issues/new?template=event-source.yml).
A URL and a region name is enough to be useful. Everything below is optional detail that makes
the work faster.

## What makes a good source

- **Local and specific.** A district calendar beats a national one. We're trying to surface the
  pub concert, not the arena tour.
- **Openly readable.** No login, no paywall, no _click to reveal_. If a human needs an account to
  see the events, we don't import them.
- **Structured, or at least consistent.** An API or feed is ideal. Failing that, a page where
  every event looks the same is fine. A hand-written prose page listing this week's events in a
  paragraph is not worth automating.
- **Maintained.** A calendar last updated in 2023 costs more to wire up than it returns.

We deliberately do **not** import from Facebook or Instagram. It requires credentials we won't
ask contributors for, the terms forbid it, and building on that foundation would recreate exactly
the dependency this project exists to escape.

## Check `robots.txt` first

```bash
curl -s https://example.no/robots.txt
```

If the events path is under `Disallow:`, we don't scrape it — we ask the owner instead. That's
often a short and welcome email: most local calendars are run by people who would be pleased to
reach a wider audience. Mention it in the issue if you're willing to make the introduction.

## Look for a hidden JSON API

This is the highest-leverage thing you can do, and it takes two minutes. Most modern event
calendars are JavaScript apps talking to a JSON endpoint. Finding that endpoint turns a brittle
HTML scraper into a stable, structured importer.

**In the browser:** open DevTools → Network → filter to Fetch/XHR → reload the events page. Look
for a request returning JSON with recognisable titles in it. Copy that URL into the issue.

**Or by hand** — check whether the page is a JS app, then guess the obvious paths:

```bash
# framework fingerprint: /_next/ means Next.js, so events likely arrive via fetch
curl -s https://example.no/events | grep -oE '/_next/|__NUXT__|data-reactroot' | head -1

# then try the boring candidates
for p in /api/events /api/v1/events /api/calendar /events.json /wp-json/tribe/events/v1/events; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code} %{content_type}' "https://example.no$p")"
done
```

A `200 application/json` is the jackpot. Paste the endpoint and a sample response into the issue.

### A worked example

`detskjer.sunnhordland.no` renders nothing useful in its HTML — it's a Next.js app. But:

```bash
curl -s 'https://detskjer.sunnhordland.no/api/events'
# → { "interval": "week", "start": "…", "end": "…", "events": [ … ], "total": 116, "next_page": 2 }
```

34 structured fields per event, including `eventTime`, `categoryName`, `organizerName` and
`ctaUrl`. No HTML parsing required. That discovery is tracked in
[the Sunnhordland importer issue](https://github.com/Hendingar/hendingar.no/labels/scraper).

Worth knowing: that site runs on **Innocode's "bestevent"** platform, white-labelled as _Det
skjer_ for Polaris Media's local titles. So the same importer likely unlocks a dozen Norwegian
regions at once. **If you spot a source that looks like a white-label of something we already
support, say so** — it's usually a config entry rather than a new scraper.

### When the endpoint is in the bundle, not the URL bar

Sometimes the fetch happens on a click you have not made yet, so reloading the page shows nothing
useful in the Network tab. The endpoint is still there — in the JavaScript.

`dnt.no/aktivitetskalender` renders a React island and no events at all server-side. Its bundle
holds two strings:

```bash
curl -s https://www.dnt.no/assets/js/main.<hash>.js \
  | grep -oE '"/[a-zA-Z0-9_./-]*(api|search|activit)[a-zA-Z0-9_./-]*"' | sort -u
# → "/api/activities"   the listing, taking the page's own query string
# → "/api/search"
```

`/api/activities` accepts the very parameters the reader sees in their address bar, so the filtered
calendar URL a turlag publishes is also the API call. **Grep the bundle for path-shaped strings**
before concluding a site has no API.

**And check that the per-item page actually loads.** DNT's listing gives every activity a tidy
`/aktiviteter-fra-deltager/…` URL, and all of them return 500 — the calendar opens a modal instead
of navigating, so nobody upstream has ever followed one. The modal fills itself from a _second_
endpoint (`/api/search/activitydetails?id=…`), which is where the description and the working
outbound link live. A URL existing in a response is not evidence that it resolves; fetch one.

### When the URL you were given is not the key

`luma.com/tcw` is a Luma calendar — Tech Cluster West, a Stord tech meetup. Luma's own client calls
one endpoint, and it takes no notice of the handle in the address bar:

```bash
# The handle gets you the page; the page gets you the id.
curl -s https://luma.com/tcw \
  | grep -oE '"api_id":"cal-[A-Za-z0-9]+"' | head -1
# → "api_id":"cal-yKlrTBwsAAkMhX3"

curl -s 'https://api.lu.ma/calendar/get-items?calendar_api_id=cal-yKlrTBwsAAkMhX3&period=future'
# → {"entries":[…],"has_more":false}
```

No key, no auth, for any calendar whose `access_level` is `public`. **`api.lu.ma`, not
`api.luma.com`** — both answer identically today, and the first is the host the site itself calls.

Three things this source taught us, all recorded in `importers/luma/`:

- **`period=future` alone loses an event the moment it starts.** Which is [#95](https://github.com/Hendingar/hendingar.no/pull/95)
  again, and worse than it sounds: a two-hour meetup would disappear from the listing at exactly
  the moment somebody checks where to go. One page of `period=past` catches anything in progress.
- **The times are real instants, and that was checked rather than assumed.** `start_at` is UTC with
  a `Z` and `timezone` is a separate IANA zone — and the calendar page's own embedded schema.org
  says `startDate: 2026-10-22T18:30:00.000+02:00` for the event the API reports as
  `16:30:00.000Z`. Two independent statements from the source, agreeing. That is the cross-check
  CLAUDE.md asks for, and it is what tells this apart from Modern Events Calendar, which adds the
  site's offset to a wall clock and then writes the offset it added.
- **`geo_address_info.city` is a post town.** The committed fixture says `Bremnes`, which is in
  Bømlo and stopped being a municipality in 1963. It goes in the address, never in
  `venues.municipality` — the same refusal the allevents, TEC and aktivitetforalle importers
  already record.

The payoff is a first for this repo: Luma repeats the coordinate Google gave the organiser when
they picked their own venue, so these venues arrive `geocode_status: resolved` with real latitude
and longitude. Not a geocoder — that was tried and rejected (`packages/core/src/address.ts`) —
but the source's own assertion about its own event, which is the only kind worth storing.

## What we already collect

Live status — every source, its method, its schedule, and what the last run actually did:
**[/datasamling](https://ca-hendingar-dev.whitewave-5f5b53f5.swedencentral.azurecontainerapps.io/datasamling)**.
Check there before proposing a source, in case it is already covered.

## How we import

Importers are **deterministic**: fetch, parse, map to our schema, done. No language models in the
import path. A scraper that produces different output from the same input is not a scraper we can
debug, and silently hallucinated event data is worse than no data.

Language models are used at a different point — for **verifying** submitted and imported events
(dedup, plausibility, categorisation) — where the input is already structured and a human reviews
anything uncertain. See the README for that pipeline.

Every imported event keeps a link to its source and shows where it came from. We are an index,
not a replacement, and we'd rather send a visitor to the original calendar than pretend the data
is ours.

## Technical feature requests

Anything that isn't a source proposal — app behaviour, API shape, importer architecture,
infrastructure — goes through
[the feature request template](https://github.com/Hendingar/hendingar.no/issues/new?template=feature-request.yml).

Read the README's [What it does not do](https://github.com/Hendingar/hendingar.no#what-it-does-not-do)
before you write it. Ticketing, payments, ads, social feeds and pay-to-rank are permanent
non-goals; those proposals get closed no matter how good the argument, because the value of a
non-goal is that it holds.
