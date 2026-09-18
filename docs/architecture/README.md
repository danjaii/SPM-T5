# Architecture docs

## C4 diagrams (`c4/`)

Source diagrams are [PlantUML](https://plantuml.com/) using the
[C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML) library, kept as plain text
(`.puml`) so they diff cleanly in PRs and never go stale next to the code they describe.

| File | C4 level | Shows |
|---|---|---|
| `context.puml` | 1 — System Context | ConnectSphere as a box, its user roles, and external systems (Supabase, email provider) |
| `container.puml` | 2 — Container | The web app, each microservice, and the database |
| `component-event-service.puml` | 3 — Component | Internal structure of one service (use as a template for the others) |

Rendered SVGs land in `c4/rendered/` automatically — see
[`c4-diagrams.yml`](../../.github/workflows/c4-diagrams.yml). Don't hand-edit files in
`rendered/`; edit the `.puml` source and let CI regenerate it.

### Editing locally

Install the PlantUML VS Code extension (or `brew install plantuml` / `apt install plantuml`)
for live preview, or use the [online C4-PlantUML editor](https://plantuml.com/) to check syntax
before pushing.

### Adding a component diagram for another service

Copy `component-event-service.puml`, rename it `component-<service>.puml`, and update the
`Component(...)` blocks to that service's actual internal structure (its router, its
manager/service classes, its repository layer). Keep one component diagram per service that
has meaningful internal complexity — trivial services don't need one.

## Architecture Decision Records (`adr/`)

One markdown file per significant decision (e.g. "why microservices per domain instead of a
monolith", "why Supabase Row-Level Security instead of an authorization service"). Use
`adr/0000-template.md` as the starting point for each new ADR; number them sequentially.
