# 0005 — PostGIS for event locations

**Status:** accepted, pending hosting confirmation (2026-08-21)

## Context

"Find events near you" is a core promise, not a feature to add later. Issue #1 states the geo
columns must exist from day one rather than being retrofitted.

Sources rarely help: `detskjer.sunnhordland.no` gives `location` as a free-text venue name
("Den Blå Time") with no coordinates at all (issue #3). So geocoding is our job, and venues repeat
constantly across events — which means a venue table with cached coordinates, not a lookup per
event.

## Decision

PostgreSQL with **PostGIS**. Venues carry a `geography(Point, 4326)` column; events reference
venues. Proximity search uses `ST_DWithin`, ordering uses `ST_Distance`.

Geocoding failures **flag the record for review — they never silently drop the event**. A
misplaced event is a bug; a vanished event is a bug we can't see.

## Consequences

- Correct distance maths on a sphere, and correct behaviour at country borders, without hand-rolled
  haversine.
- Spatial indexes (GiST) make proximity queries fast enough to be the default sort.
- Adds an extension dependency, which constrains hosting (below).

## Open risk — hosting

Azure Database for PostgreSQL Flexible Server requires PostGIS to be **allow-listed** on the
server before `CREATE EXTENSION` will succeed. This must be confirmed as part of issue #2 before
this decision is fully settled.

Fallback if unavailable: plain `latitude` / `longitude` numeric columns with a bounding-box
prefilter and distance computed in SQL. Workable, meaningfully worse, and a migration away — which
is exactly why it's worth confirming early rather than discovering late.

## How we'd know we were wrong

If the hosting platform can't provide PostGIS, or if proximity queries turn out to be a negligible
share of traffic and the extension is pure overhead.
