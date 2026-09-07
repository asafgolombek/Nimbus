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

### Which URL column, and one deliberate divergence

The sibling route selects the bare `url` column
(`packages/gateway/src/index/resolve-by-url.ts:58`), not a coalesce. This route
matches it — a response that claimed to be the same projection while quietly
applying different precedence would be worse than an honest difference.

The one divergence: **when `url` is null and `canonical_url` is not, return
`canonical_url`.** A reference the reader can follow beats no reference, and the
fallback only ever fires where the sibling would have returned null anyway, so
no caller sees a *different* URL for the same row — only a URL where it would
otherwise have had none.

Note this is the opposite precedence from the row's own `resolve_key`, which is
derived canonical-first. That is correct: `resolve_key` exists to make two
spellings of the same address match, so it wants the normalized form. This field
exists to be clicked, so it wants the address the provider actually published.
Flagged explicitly because it is the one place a reviewer may reasonably prefer
strict parity with the sibling instead.

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

`null` therefore survives all the way to the reader, who sees the title as plain
text rather than a link — the same rule the browser already applies to every
reference it renders.

### Errors

| condition | status | body |
| --- | --- | --- |
| clips surface unmounted | 404 | `{ "error": "resolve_disabled" }` |
| no `id` parameter, or all blank | 400 | `{ "error": "missing_id" }` |
| more than `RESOLVE_IDS_MAX_BATCH` raw ids | 400 | `{ "error": "too_many_ids" }` |
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

**Count the raw parameters before de-duplicating.** Checking the cap after
de-duplication would let a caller send fifty thousand copies of one id and pay
only the parsing and set-building cost — cheap for them, not for the gateway.
The order is: read `getAll("id")`, refuse if the *raw* count is over the cap,
then trim and drop blanks, then refuse as `missing_id` if nothing survives, then
de-duplicate.

**Return the rows in a deterministic order** (`ORDER BY id`). `IN (…)` does not
preserve parameter order, and callers join by id rather than by position, so
ordering carries no meaning — which is exactly why it should be stable rather
than incidental, so a wire response is reproducible in tests across platforms.

### The cap: `RESOLVE_IDS_MAX_BATCH = 100`

`RESOLVE_CANDIDATE_CAP`'s rationale (`resolve-by-url.ts`) is why there is a cap
at all:

> Candidate lists are capped: rung 3 trims path segments and can match broadly,
> so an uncapped list would turn a mis-trimmed URL into a bulk index read over a
> `resolve`-scoped token.

A `?id=` list is that risk in a more direct form. SQLite's bind-parameter
ceiling (32,766) is not the binding constraint; the token scope is.

**Borrow that rationale, not its magnitude.** `RESOLVE_CANDIDATE_CAP` is **5**,
which is right for a disambiguation menu a human reads and hopeless here:
`catchup` alone admits up to `PER_SERVICE_QUOTA = 50` items **per service**
(`packages/gateway/src/agents/catchup.ts:12`), across several sections in one
brief. A cap anywhere near 5 would refuse the single largest consumer on its
ordinary path — a caps-are-good instinct producing a route that does not work.

**100** clears a dense `catchup` brief with room, sits three orders of magnitude
under the bind ceiling, and stays well inside any URL-length limit. A client
holding more than that chunks; the client is the one that knows which references
are worth resolving.

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
- **I13 does not apply, and that is the point.** I13 governs HTTP *write* routes
  (`WRITE_ROUTE_ALLOWLIST` + bearer auth, `docs/SECURITY-INVARIANTS.md`). This is
  a read: it stays off that allowlist and mounts in the bearer-authed GET family
  instead. Named here because "new HTTP route" is the trigger a reviewer will
  reach for I13 on, and the answer is that it is the wrong invariant for this
  one.
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

The integration test belongs beside its siblings as
`packages/gateway/test/integration/http/items-resolve-ids-route.test.ts` —
`items-resolve-route.test.ts` and `items-resolve-file-route.test.ts` are already
there, and #1447 established the shape.

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

## 11. Review disposition

Reviewed against
[`2026-09-07-items-resolve-ids-design-review.md`](./2026-09-07-items-resolve-ids-design-review.md).
Each finding was checked against the gateway source before being accepted.

**Accepted.**

| finding | verified against | resolution |
| --- | --- | --- |
| Q2.1 the cap must clear a real brief | `catchup.ts:12` — `PER_SERVICE_QUOTA = 50` per service | §5 now names `RESOLVE_IDS_MAX_BATCH = 100` and separates the precedent's *rationale* from its magnitude |
| Q2.2 count raw parameters before de-duplicating | — (reasoning, not a code claim) | §5: the four-step order, with the reason a post-dedup check is cheap for the caller and not for the gateway |
| Q2.3 deterministic ordering | `IN (…)` does not preserve parameter order | §5: `ORDER BY id`, framed as reproducibility rather than meaning |
| Q2.4 concrete URL selection | `resolve-by-url.ts:58` | §4 — but with the precedence **inverted**, see below |
| I13 is the write-route invariant | `docs/SECURITY-INVARIANTS.md:242` | §8: named as the invariant a reviewer will reach for and why it does not apply |

**Q2.1 is the one that mattered.** The original draft cited
`RESOLVE_CANDIDATE_CAP` as "the precedent" without naming a number. That cap is
**5**. A reader taking the precedent for a magnitude would have shipped a route
that refuses `catchup` — the single largest consumer — on its ordinary path. The
draft was not wrong so much as silent in a place where silence reads as guidance.

**Accepted problem, opposite fix.**

- **Q2.4 recommended `COALESCE(canonical_url, url)`** — canonical first, matching
  how the row's `resolve_key` is derived. Rejected in that direction, on evidence
  the review did not check: `resolve-by-url.ts:58` selects the **bare `url`
  column**, so canonical-first would have made this response semantically
  different from the sibling projection it claims to be field-for-field. The
  original draft made the same error, in prose. §4 now matches the sibling and
  falls back to `canonical_url` **only when `url` is null** — the fallback fires
  exactly where the sibling would have returned nothing, so no caller ever sees a
  different URL for the same row. `resolve_key` wants the normalized form because
  it exists to make two spellings match; this field wants the published address
  because it exists to be clicked.

**Declined.**

- **§3's module layout and implementation code.** This document is a contract
  proposal, and its own header says no code lands in this branch. The gateway
  owns the wire and its implementation; a consumer that arrives with the module
  already written has pre-empted the decision it came to ask for. The
  *behavioural* requirements that code encoded — the cap, the parse order, the
  ordering, the exact projection — are captured above as contract, which is the
  part a consumer legitimately has an opinion about.

**Noted.**

- The review's §5.3 places the integration test at
  `packages/gateway/src/ipc/http-server.test.ts`. That file does exist, but the
  per-route convention is `test/integration/http/<route>-route.test.ts`, where
  both resolve siblings already live. §8 now says so.
