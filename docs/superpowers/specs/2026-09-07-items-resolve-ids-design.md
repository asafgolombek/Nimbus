# `GET /v1/items/resolve-ids` — turning an item id back into a reference

> **Status:** proposal. No code in this branch — this is the contract, argued
> before it is built, per the satellite-repo convention that the gateway owns
> the wire and consumers propose against it.
>
> **Proposed by:** the browser client (`nimbus-web-clipper`), which is blocked
> on it for four of its seven agent lanes.

## 1. What this is

One bearer-authed read that maps **indexed item ids to the references they came
from**:

```text
GET /v1/items/resolve-ids?id=github:acme/web%23482&id=jira:PLAT-91
```

It is the inverse of `GET /v1/items/resolve`, which maps a URL to an item. That
direction has existed since the clip surface shipped. This one has not, and its
absence is now load-bearing for a shipped feature.

## 2. The concrete gap

Every agent brief the browser renders is a typed object, and several of them
name other indexed items — but by **id only**, with no URL:

| finding | the id it carries | URL? |
| --- | --- | --- |
| `ExpertFinding.evidence[].itemId` | the PR, issue or commit that evidences someone's expertise | none |
| `ImpactFinding.affectedItemId` | the thing that breaks if this change lands | none |
| `CatchupItem.itemId` | each item that changed while you were away | none |

The browser now renders these briefs as structure rather than prose (phase C8 in
`nimbus-web-clipper`; `why`, `glossary` and `decisions` shipped in v0.6.0 and
the release after it). Those three lanes carry real URLs in their findings, so
their entries are clickable. **The four remaining lanes carry ids only**, so a
reader gets a list of titles that look like links, are not, and cannot be made
into links by any client-side means — `GET /v1/items/resolve` goes URL → item,
and nothing goes the other way.

The client-side slice that renders those four lanes is designed and waiting. It
ships either way; with this route it ships with references, without it a title
is a dead end.

## 3. Why this is narrower than what the gateway already serves

The reflexive objection to an id-keyed read is that it is an enumeration oracle:
a caller could confirm which items exist by asking.

**That is already true, unauthenticated, with far more disclosure.**
`packages/gateway/src/ipc/http-route-auth.ts:48-49`:

```ts
  "GET /v1/items": { kind: "public" },
  "GET /v1/items/*": { kind: "public" },
```

`GET /v1/items/{id}` is `{ kind: "public" }` — no bearer gate at all — and its
handler returns the **entire row**, including `body`, `metadata` and
`author_id`. Any local process can already resolve an arbitrary item id to its
URL *and* its body today.

This proposal is therefore **strictly less disclosure than the status quo**: a
`resolve`-scoped token, six named fields, no body, no metadata, no author. The
only thing it adds is arity — asking about several ids in one round trip instead
of one at a time.

That is the whole security argument, and it should be stated first in review so
the discussion is about arity rather than about disclosure.

## 4. Proposed contract

### Request

`GET /v1/items/resolve-ids`, with `id` repeated once per item — the same shape
as the existing repeated `?service=` parameter on `GET /v1/items`.

Bearer-authed under the **existing `resolve` scope**, for the same reason
`resolve-file` is: it reads, it runs nothing, and it appends no egress row.

### Response

```json
{
  "items": [
    {
      "id": "github:acme/web#482",
      "service": "github",
      "type": "pull_request",
      "title": "Rewrite the auth middleware",
      "url": "https://github.com/acme/web/pull/482",
      "modified_at": 1757203200000
    }
  ]
}
```

Field-for-field this is `ResolveCandidate` plus `modified_at` — exactly the
projection `GET /v1/items/resolve`'s `found` arm already returns
(`packages/gateway/src/index/resolve-by-url.ts`). That is deliberate: the
browser already has the type, the parser and the renderer for this shape, so
consuming it costs a call site rather than a new model.

**An id that is not indexed is simply absent from `items`.** It is not an error
and not a null entry. Absent and `url: null` are different facts and the client
renders them differently: absent means "the index does not hold this", `url:
null` means "it does, and it has no source URL". Collapsing them would make a
missing item indistinguishable from a URL-less one.

### `url` is nullable, and must stay nullable

Both URL columns on `item` are nullable and many item types genuinely have
none — derived items, brief saves, glossary projections. The SDK already made
this exact call for `WhyItemSubject.url`, and its reasoning applies verbatim: a
non-null type "would force it to substitute the URL it was *asked* with for the
one the item *has*, which is a fabricated field inside a subject."

Where both `url` and `canonical_url` exist, return the same precedence the row's
own `resolve_key` is derived from — canonical over raw — rather than inventing a
second rule.

### Errors

| condition | status | body |
| --- | --- | --- |
| clips surface unmounted | 404 | `{ "error": "resolve_disabled" }` |
| no `id` parameter, or all blank | 400 | `{ "error": "missing_id" }` |
| more ids than the cap | 400 | `{ "error": "too_many_ids" }` |
| token lacks `resolve` | 403 | the standard scope-gap body |

The 404 is the capability signal (§7) and must come **before** the auth check,
matching `resolve-file` — a client reads it as "gateway older than the route"
and withholds its links silently. A 500 there would turn a correct quiet
degradation into a visible error.

## 5. Design decisions

### It has to be batched

A single findings payload routinely names a dozen or more ids — a `catchup`
brief with several populated sections can name many more. One round trip per id,
over a panel that is already polling, is the wrong shape. No route on the surface
accepts multiple ids today, so this is a new arity; it is not a new *kind* of
input, since `POST /v1/clips/related` already takes a browser-supplied item id.

De-duplicate before binding, join back by id, and bind every value as a
parameter — never interpolate ids into the `IN (…)` list.

### The cap, and refusing rather than truncating

`RESOLVE_CANDIDATE_CAP`'s rationale (`resolve-by-url.ts`) is the precedent and
the reason:

> Candidate lists are capped: rung 3 trims path segments and can match broadly,
> so an uncapped list would turn a mis-trimmed URL into a bulk index read over a
> `resolve`-scoped token.

A `?id=` list is that risk in a more direct form, so it takes a cap. SQLite's
bind-parameter ceiling is not the binding constraint; the token scope is.

**Over the cap, refuse with 400 rather than clamping.** The repo has both
postures — `parsePositiveInt` clamps a `limit`, `nimbus media allow-remote`
refuses above 500 — and refusal is right here. Silently dropping ids means
silently dropping *links*: the reader sees some references and not others, with
nothing to say why. A caller over the cap has a bug and should hear about it.

Note this differs from `resolve`'s over-cap behaviour, which returns an empty
candidate list plus `truncated: true` because "a truncated choice menu implies
the right answer is among those shown when it may not be." An id-keyed map has
no implied ranking, so that argument does not transfer; the honest failure here
is a refusal.

### A flat path, not a regex

Match `url.pathname === "/v1/items/resolve-ids"` and pass ids as query
parameters. `http-route-auth.test.ts` source-scans `http-server.ts` for route
literals and additionally pins the count of regex-routed GETs, so a path-embedded
id (`/v1/items/resolve-ids/{id}`) would need an explicit `REGEX_ROUTED_GET`
entry. The flat form stays inside the `tryBearerAuthedGet` family the existing
test server already harnesses, and costs nothing.

### Mounted inline, never in the public GET table

The `"GET /v1/items/*"` entry is `{ kind: "public" }` with no bearer gate, so
routing this through `dispatchReadOnlyDataGet` would serve scoped output to any
local process. It mounts inline in `tryBearerAuthedGet`, exactly as
`resolve-file` does and for the same stated reason.

### The response is written field by field

Never a spread and never a destructured rest, matching `resolve-file`'s handler:
a field added later to the internal row type cannot then leak here unnamed. The
integration test pins `Object.keys(body.items[0]).sort()` to an exact set.

## 6. What this is not

- **Not a body read.** No `body`, no `body_preview`, no `metadata`, no
  `author_id`, no `external_id`. `resolve`'s own note applies — it is a
  resolver; reading is `GET /v1/items/{id}`.
- **Not a federation surface.** It reads the local `item` table and must never
  grow an outbound peer arm. The reasoning behind the invariant that keeps a
  browser-reachable *file* question local applies unchanged to a
  browser-reachable *item* question: any holder of that token could otherwise
  turn a question about one item into outbound peer calls, from a client whose
  entire premise is that it talks to loopback and nothing else. If that is ever
  wanted it is a new decision with its own gate, not a relaxation of this one.
- **Not egress.** No provider request, no ledger row. The
  `egress-coverage.ts` comment that names the newest such route by name should
  be re-pointed at this one when it lands.
- **Not a schema change.** No migration, no new column, no new index — `item.id`
  is the primary key.
- **Not an OpenAPI addition.** Like every other clip-scoped bearer read, it stays
  off `HTTP_ROUTES`.

## 7. Rollout

**Route presence is the capability signal. There is no version floor.**

This follows `resolve-file` exactly: the client probes, reads a 404 as "this
gateway does not have it", and withholds the links silently. A floor constant
would have to be raised by hand on every future change; presence cannot drift.

The `resolve` scope already exists, so **no re-pairing**. A browser paired before
scopes existed holds the legacy set and gets a 403 naming the fix, repairable in
place with `nimbus clip scopes` — the same story as every other scoped read.

## 8. Compliance checklist

- **Token verification.** Routes through the standard scoped-clip-token path;
  never a hand-rolled scope check.
- **Route auth table.** A new `ROUTE_KEY_*` constant, an entry
  `{ kind: "clip", scope: "resolve" }`, and a member added to the read-route
  union — the union exists so passing a raw request path is a compile error
  rather than a runtime fail-open. Three completeness tests enforce this.
- **Parameter binding.** Placeholders built from the array length, every value
  bound; no interpolation.
- **Egress ledger.** No row appended, asserted by a count delta in the
  integration test rather than by inspection.
- **Disclosure guard.** An exact-key-set assertion on the response, so a widened
  internal row cannot leak.
- **The unmounted branch.** A test that the 404 fires before auth.

## 9. Alternatives considered

**Have the client call `GET /v1/items/{id}` per id.** It is public, it already
returns the URL, and it needs no new route. Rejected: it returns the entire row
including `body` and `metadata` to a client that wants six fields, it is
unauthenticated where the rest of the browser's surface is scoped, it is one
round trip per reference, and it is not part of the clip contract the client is
built against. Using it would be the client reaching around its own boundary.

**Put URLs into the agent briefs themselves.** Arguably the tidier fix — the
agents have the rows in hand. Rejected as the larger change: it alters what
several agents *return*, which is a three-repo chain through the SDK's published
brief types, and it inflates every brief with data most consumers do not render.
A reverse lookup is additive and consumers opt in.

**Return a map keyed by id rather than an array.** Marginally more convenient
for the client, but item ids contain characters that make them awkward object
keys, and the array form matches the projection the neighbouring resolve route
already returns. The client joins by id either way.

## 10. What the client does with it

For the record, so the shape is judged against a real consumer rather than in
the abstract. On a resolved agent lane the browser already holds the typed
brief; it collects the ids its renderer would otherwise print as dead text,
issues one `resolve-ids` call, and renders each as a link where the response
carries a URL — falling back to plain text where it does not, which is the
existing rule for every reference it renders.

It is one call per lane expansion, bounded by the cap, on a surface that is
already polling. No new destination: the browser's only network target remains
the gateway on loopback.
