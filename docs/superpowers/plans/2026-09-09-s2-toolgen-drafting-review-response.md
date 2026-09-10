# Response — implementation-plan review, toolgen drafting

**Date:** 2026-09-09
**Reviewing:** [`2026-09-09-s2-toolgen-drafting-review.md`](./2026-09-09-s2-toolgen-drafting-review.md) (Antigravity)
**Target:** [`2026-09-09-s2-toolgen-drafting.md`](./2026-09-09-s2-toolgen-drafting.md)

Six recommended edits. **All six accepted** — the first is a plan failure rather than a refinement,
and one of the others reverses a decision the earlier design review made in the opposite direction.
Fixing the first also surfaced a second defect the review did not name.

---

## Verdicts

| # | Item | Verdict |
|---|---|---|
| 2.1 | `vaultHasToolCredential` / `toolgenPendingCreds` do not exist | **Accepted — plan failure.** Tasks 6, 9, 11 reworked. |
| 2.2 | Anchored `stripFence` burns the redraft on a preamble | **Accepted.** Replaced by `extractJsonPayload`. |
| 3.1 | Validate property names as JS identifiers | **Accepted — reverses the design review's rejection.** |
| 3.2 | Deduplicate `required` | **Accepted.** It is canonicalisation, which the artifact is hashed on. |
| 3.3 | Render `string[]` rather than `array` | **Accepted.** |
| — | The prompt was built from RAW hosts | **Found while fixing 2.1; not in the review.** |

---

## 1. The phantom wiring — a plan failure, not a refinement

Task 11 wired:

```ts
credentialHostsFor: (hosts) => hosts.filter((h) => vaultHasToolCredential(toolgenPendingCreds, h)),
```

Neither symbol exists — confirmed by grep across `packages/`. The `writing-plans` skill names this
exact category ("references to types, functions, or methods not defined in any task") as a plan
failure, and it is: an implementer reaching Task 11 would have stopped dead.

The deeper point is the one that matters, and the review states it correctly: **no arrangement of
those two symbols could have worked.** That closure is built once, at boot, inside
`assemblePlatformServices`, while the approved hosts and their credential subset are per-request.
And at draft time nothing has been written to the Vault at all — `bindCredentials` runs at gate
step 5, *after* drafting — so even a request-scoped Vault probe would have reported an empty list
on every single create. The prompt's "a credential is attached automatically for these hosts" line
would have been permanently absent, silently.

**Fix, as the review proposes.** The gate already holds the answer: it receives `credentials` as
its third parameter and normalises `hosts` itself. `draftTool` now takes a second argument:

```ts
export interface DraftSubject {
  readonly hosts: readonly string[];
  /** Hosts that will carry a credential. NAMES ONLY — never a secret (spec § 9.1). */
  readonly credentialHosts: readonly string[];
}
```

`credentialHostsFor` is gone from `ToolgenDraftDeps`, and `assemble.ts` passes `subject` straight
through. The § 9.1 property is unweakened and arguably stronger: `DraftSubject` is a type that
cannot carry a secret, where the old dep was a function that could have been wired to one.

## 2. A second defect, surfaced by the first fix

The 2.1 fix required moving host normalisation above the draft. That exposed something nobody had
flagged: the plan built the prompt from **`req.hosts`** — the raw strings the owner typed.

`normalizeHost` exists because an owner will write `https://api.github.com/v1` or
`api.github.com:443`, while the broker matches `url.hostname` exactly. So the prompt would have
told the model to call `https://api.github.com/v1`, and the broker would have refused every request
that model dutifully wrote. Fixed by `subject.hosts`, with a test asserting the normalised form
reaches the prompt and the raw form does not.

Moving normalisation up is independently better: `normalizeHost` throws
`ERR_TOOLGEN_HOST_NOT_ALLOWED`, and refusing a malformed host **before** spending a model call
beats refusing after. Everything stays pre-consent, so the gate's ordering rule is untouched.

## 3. `extractJsonPayload` — accepted

The anchored regex requires the entire trimmed reply to be the fence, so
`"Here is the tool:\n```json\n{…}\n```"` matches nothing, falls through as raw text, fails
`JSON.parse`, and spends the single redraft on a formatting artifact — the budget that exists for
real defects.

Widening is safe for a reason worth stating in the code, and now is: **`JSON.parse` downstream
remains the actual gate.** An over-eager brace slice that grabs prose simply fails rung 1, exactly
as no extraction would have. The change can make a malformed reply parse; it cannot make a
non-object one pass. `lastIndexOf("}")` rather than the first closing brace, so a `}` inside the
body string does not truncate the object — with a test for that.

## 4. Identifier validation — accepted, reversing the design-review verdict

The [design review response](../specs/2026-09-09-s2-toolgen-drafting-design-review-response.md)
§ 7 rejected this, on the grounds that `args["page-size"]` is legal JavaScript and zod keys are
arbitrary strings, so the rule would reject hyphenated API parameters to prevent nothing.

**That reasoning was wrong on the point that matters, and the new argument is a different one.** The
hazard is not the schema; it is the *body*. `args.repo-name` parses as `args.repo - name`, so it is
**valid JavaScript** — verified against the `AsyncFunction` constructor the plan uses, which
compiles it without complaint. Rung 3 passes it, rung 4 does not look for it, the owner approves it,
and it fails at runtime.

The earlier objection also does not survive inspection: the schema names the **tool's own**
arguments, which the model chooses freely and which need not mirror the API's wire names. A
hyphenated API parameter stays perfectly reachable — the model declares `repoName` and writes
`"repo-name"` into the URL it builds. So the restriction costs approximately nothing and closes a
class of body that compiles and then fails after approval. Adopted, with two rejection tests.

## 5. Deduplicating `required` — accepted, for a reason the review did not give

The review offers it as tidiness. It is slightly more than that: `validateInputSchema` returns the
**canonical** form, and that schema goes inside the artifact `artifactDigest` hashes and PR 3 signs.
Two schemas that mean the same thing must not produce two digests. Behaviour is unchanged either way
— `zodSchemaFromInputSchema` already dedupes through a `Set` — so this is purely about the canonical
bytes, which is exactly why it belongs in the normaliser.

## 6. `string[]` in the approval prompt — accepted

`tags: array?` tells the owner less than `tags: string[]?`, and this prompt is the security boundary
for the whole capability. It should say the most it can in the space it has.

---

## What did not change

The review's § 4 verification matrix and § 1 strengths need no response; they restate the plan.
No task was added or removed, no invariant moved, and the delivery shape is unchanged: still one PR,
twelve tasks, no migration, no new static rule.

One thing considered and **deliberately not** folded in: `assertConfinement` could also move above
the draft, so a machine whose sandbox cannot confine never spends a model call. It is a real
improvement, but it reorders shipped PR-1 behaviour for an efficiency gain rather than a correctness
one, and the current order is already correct on the security property. Recorded here rather than
taken.
