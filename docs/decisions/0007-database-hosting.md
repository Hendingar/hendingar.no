# 0007 — Azure Postgres Flexible Server B1ms, on Nordlo's sponsorship credits

**Status:** accepted (2026-08-26)

## Context

The README originally specified Scaleway Serverless SQL — genuinely pay-per-request Postgres. Moving
compute to Azure (#2) left the database open, because **Azure has no serverless Postgres available
on this subscription**. Verified rather than assumed:

- `Microsoft.DBforPostgreSQL` Flexible Server offers only `Burstable`, `GeneralPurpose` and
  `MemoryOptimized`. All are provisioned continuously. `az postgres flexible-server stop` exists but
  is manual and auto-restarts after 7 days — it is not scale-to-zero-on-idle.
- Azure's serverless Postgres is **Neon**, via Azure Native ISV Integration. The `Neon.Postgres`
  provider namespace is not available on this subscription, and was still unavailable after a
  subscription Owner had access. Same for `Microsoft.CosmosDB`, `Aiven.Aiven` and Timescale. The
  likeliest cause is that Marketplace/ISV offers aren't covered by sponsorship credits.

## Decision

**Azure Database for PostgreSQL Flexible Server, `Standard_B1ms` Burstable, Sweden Central**, in
`rg-hendingar-swc-dev`, on the Nordlo sponsorship subscription.

PostGIS is enabled through the `azure.extensions` server parameter, which RG Contributor can set —
no Owner step (this resolves the open risk in [ADR 0005](0005-postgis-geo.md)).

## Consequences

- **The database is a standing cost, not a spike.** Container Apps scale to zero; a B1ms does not.
  This is the honest trade we accepted rather than engineering around: it's the cheapest tier
  available, on credits that exist for exactly this kind of experiment, with Nordlo named openly as
  the sponsor rather than being an implicit dependency.
- **It is a single point of failure with no HA**, and Burstable tier means CPU credits can be
  exhausted under sustained load. Fine for a pilot region; not fine for a popular EU-wide service.
- **Rejected: Neon direct, outside Azure.** Genuinely scale-to-zero with a free tier, and it would
  decouple the database from Nordlo's credits entirely. Rejected for now because it splits the
  hosting story across two vendors for a project that has one region and no users. The DB is a
  `DATABASE_URL` boundary under [ADR 0002](0002-remote-functions.md)'s portability rule, so this
  remains a cheap decision to revisit — deliberately so.
- **Rejected: Flexible Server with scheduled stop/start.** Would cut dev cost, but the whole point
  of this environment is that it's reachable. A site that's down outside office hours isn't a
  deployment.

## Follow-up: get rid of the password

This ships with password authentication because it's the shortest path to a running site, and the
admin password is supplied by a human via a GitHub Actions secret — never generated or stored by
tooling, never in the repo.

Flexible Server also supports **Microsoft Entra authentication**, which would let the Container App's
managed identity connect with a token and remove the password from existence entirely. That is the
better design and the intended destination; it needs token-refresh handling in the connection layer
(`postgres.js` takes a function for `password`), which is more than a first deploy warrants.

## How we'd know we were wrong

If the monthly credit draw becomes a problem, or the project outlives the sponsorship arrangement,
or traffic outgrows a single burstable instance. Any of those makes Neon — or a managed Postgres
bought deliberately rather than sponsored — the better answer.
