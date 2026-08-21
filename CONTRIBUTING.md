# Contributing

This is a community project. Code, docs, design, bug reports and event data are all welcome, and
you don't need permission to start.

## Where things go

| I want to… | Do this |
| --- | --- |
| Suggest a site to import events from | [Propose an event source](https://github.com/Hendingar/hendingar.no/issues/new?template=event-source.yml) — read [docs/event-sources.md](docs/event-sources.md) first |
| Request a technical change | [Feature request](https://github.com/Hendingar/hendingar.no/issues/new?template=feature-request.yml) |
| Report something broken | [Bug report](https://github.com/Hendingar/hendingar.no/issues/new?template=bug-report.yml) |
| Ask a question | Open a blank issue |

## Before you propose a feature

Read [What it does not do](README.md#what-it-does-not-do). Ticketing, payments, ads, social
feeds and pay-to-rank are permanent non-goals. Proposals there get closed regardless of how well
they're argued — a non-goal is only worth having if it holds under pressure.

## Working on code

```bash
git clone https://github.com/Hendingar/hendingar.no
cd hendingar.no/app
pnpm install
pnpm dev
```

Small PRs, please, and one concern each. If a change is large or architectural, open an issue
first so nobody spends a weekend on something that turns out to conflict with the roadmap.

Importers must be deterministic — no language models in the import path. See
[docs/event-sources.md](docs/event-sources.md#how-we-import) for why.

## Licence

Contributions are licensed under [AGPL-3.0](LICENSE), same as the project.
