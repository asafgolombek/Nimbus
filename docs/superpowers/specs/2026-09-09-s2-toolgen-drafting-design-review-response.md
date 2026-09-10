# Response — design review of the toolgen drafting step

**Date:** 2026-09-09
**Reviewing:** [`2026-09-09-s2-toolgen-drafting-design-review.md`](./2026-09-09-s2-toolgen-drafting-design-review.md) (Antigravity)
**Target:** [`2026-09-09-s2-toolgen-drafting-design.md`](./2026-09-09-s2-toolgen-drafting-design.md)

Every claim below was checked against `main` at `65bda8ef` before it was accepted or rejected. Two
were verified by running code rather than by reading it, because both were assertions about engine
behaviour that reading cannot settle.

---

## Verdicts

| # | Item | Verdict |
|---|---|---|
| 2.1 | `new Function` cannot compile an `await` body | **Accepted — blocking.** Spec § 4.2 rung 3 rewritten to `AsyncFunction`. |
| 2.2 | Rung 4 must match on word boundaries | **Accepted; stated reason corrected.** |
| 2.3 | `nimbusFetch` does not return a `Response` | **Accepted.** New spec § 4.4. |
| 2.4 | Widen the request and `bindCredentials` | **Accepted in part; proposed shape rejected.** New spec § 9.1. |
| 3.1–3.3 | Verbatim prompt template | **Deferred to implementation; its contract content accepted.** |
| 4.1 | `validateInputSchema` implementation | **Deferred**, except `anyOf`/`$schema` — accepted. Identifier restriction rejected. |
| 4.2 | Zod conversion with `.optional()` | **Accepted.** Spec § 5.4. |
| 5.1 | `findEndpoints` via SQL `LIKE` | **Rejected.** Spec § 6.1 now forbids it explicitly. |
| Q1 | `URLSearchParams` guidance | **Accepted** into § 4.4. |
| Q2 | Default `<host>=<token>` to bearer | **Accepted; its fallback rejected as non-existent.** New spec § 9.2. |
| Q3 | CLI hint on local-model failure | **Accepted.** Spec § 8. |
| § 7 | Five added tests | **Accepted**, plus two the review did not name. |

---

## 1. `new Function` — accepted, and it was blocking

Verified rather than reasoned about, on Bun:

```text
new Function("args", "const r = await nimbusFetch(u); return r;")
  -> SyntaxError: Unexpected identifier 'nimbusFetch'
AsyncFunction("args", <same body>)
  -> compiles
```

The spec's rung 3 would therefore have rejected **every valid draft** — the failure mode where a
gate looks strict and is simply broken. Fixed, with the verification recorded inline so the next
reader does not have to re-derive why the constructor is unusual.

## 2. Word boundaries — accepted, reasoning corrected

The fix is right; the argument for it is not. The review states:

> `"nimbusFetch(".includes("fetch(")` evaluates to `true`.

It evaluates to **`false`**. `nimbusFetch` carries a capital `F`, so the lowercase substring does
not occur in it, and the specific danger described cannot happen. Checked, because a fix resting on
a false premise usually protects the wrong thing.

The hazard is real for other spellings — `prefetch(` and `client.fetch(` both genuinely contain
`fetch(` and would be rejected by a substring test — so the boundary-anchored match is adopted, and
the spec now names those two rather than the one that does not apply. This is the
`guard-must-check-value-not-token` shape, and the corrected examples are what the tests assert.

## 3. The `nimbusFetch` return contract — accepted

Verified in `toolgen-broker.ts`: the broker resolves `{ status, statusText, headers, body }` with
`body` produced by `new TextDecoder().decode(bytes)` — a string, not a stream, and not a `Response`.
A model reaching for `await res.json()` is the predictable default, and such a body **passes every
rung** — valid syntax, no forbidden global — and fails only at runtime, after the owner has
approved it. That makes it a contract fact rather than a prompt-wording detail, so it is now spec
§ 4.4 rather than left to the implementer.

## 4. Credentials — accepted, but not in the proposed shape

The signature must widen: `bindCredentials(toolId, hosts)` cannot write a token it never receives.
Accepted.

The proposed route is unsafe. The review puts `credentials` on `CreateGeneratedToolRequest` — and
the gate calls `deps.draftBody(req)` with **that same object**. Raw tokens would land on the input
to the drafting prompt builder, and a secret in a remote model's context has left the machine, with
no `credentialHosts` disclosure and no tie to the host it was bound to. The parent spec's "a
credential never enters the tool process" extends to the drafting prompt for identical reasons.

The gate takes credentials as a **second parameter** instead, so `draftTool` continues to receive
only `{sessionId, description, hosts}` and the type cannot carry a token to the drafter at all. The
drafter still learns *which* hosts will carry one — that shapes a correct body, since it must not
hand-write an `Authorization` header — and never the value. Spec § 9.1.

## 5. `findEndpoints` via `LIKE` — rejected

The proposed query binds the **entire description** as one `%…%` term against `path`,
`operation_id`, `title` and `body_preview`. That asks whether a natural-language sentence occurs
verbatim inside a URL path. For any real request it returns zero rows.

The consequence is worse than a bad result: grounding would report `description_only` on every
request, the § 6.2 disclosure would be **truthful each time**, and a test asserting the disclosure
would pass. It would present as "the owner has not indexed any specs" indefinitely.

`search/hybrid.ts`'s `hybridSearch` already fuses BM25/FTS5 with vector search by RRF and already
takes an `itemType` filter; `openapi-indexer-sync.ts` writes these rows as `type: "api_endpoint"`.
`findEndpoints` is that call. Spec § 6.1 now says so and names the shortcut as forbidden, and § 11
adds a retrieval test that seeds endpoints and asserts rows come back — without which a
matches-nothing implementation is indistinguishable from an empty index.

## 6. Q2 — the default accepted, the fallback rejected

Defaulting `--credential <host>=<token>` to a `bearer` binding is right and is adopted.

The stated fallback is not available. The review advises that for custom headers or basic auth
"users can continue to use `nimbus tool credential set` prior to recreation". That command
**always fails**: there is no `toolgen.credentialSet` RPC method, and the CLI handler
unconditionally prints "cannot add a credential to an already-approved (live) tool" and directs the
owner to revoke and recreate. It is a refusal stub by design — binding after approval would change
an artifact the owner already approved — so it can be nobody's fallback.

Following that thread surfaced a gap neither document had: `ToolCredentialBinding` has three
variants and `applyCredential` implements all three, but the only user-facing producer emits a bare
token, so **`header` and `basic` bindings are reachable from no path at all**. Recorded as spec
§ 9.2 and stated bound 5 rather than left in the code for someone to find. The spec's own § 9 also
described `credential set` as "already parses `--bearer`/`--header`/`--basic`" — true, and
misleading, since it parses and then refuses. Corrected.

## 7. Deferred, with reasons

**The verbatim prompt template (§ 3.1–3.3).** A prompt reproduced in a spec rots against the code
that owns it, and this one would carry the `nimbusFetch` signature — the exact thing most likely to
change. What the prompt must *state* is a contract and is now § 4.4; how it words it belongs with
the implementation and its tests.

**`validateInputSchema` as written (§ 4.1).** Implementation detail; the plan will carry it. Two
substantive points extracted: `anyOf` and `$schema` join the rejected-keyword list (a real omission
in the spec's list), and the check is explicit-rejection rather than validate-by-absence.

**The identifier restriction on property names — rejected.** The review requires every property to
match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. `args["odd-name"]` is legal JavaScript, zod object keys are
arbitrary strings, and the value crosses a JSON protocol where any string key survives. It would
reject a legitimate schema — `page-size`, or any API whose parameters are hyphenated — to prevent
nothing. Not adopted.

## 8. Tests

All five additions accepted. Two more added that the review did not name, both covering the defects
it found rather than the fixes:

- **The drafter never receives a token** — asserted on the object handed to `draftTool`, not on the
  rendered prompt, because a prompt assertion passes for a secret that is present but unused.
- **Grounding actually retrieves rows** — the § 5 failure above is silent without it.

The rung-3 test is worth singling out: a ladder suite naturally fills up with *invalid* inputs, all
of which fail correctly under the broken constructor. Only a **valid** `await` body distinguishes a
strict rung from a broken one.
