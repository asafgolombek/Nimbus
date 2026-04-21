# Review: Phase 4 Completion — Design Spec

This review identifies open questions, suggestions, and potential improvements for the "Phase 4 Completion — WS5-D + WS6 + WS7 + A.1/A.2 + `v0.1.0` Unsigned Preview Release" design document.

## 1. Procurement & Infrastructure (Section 0)

- **Domain Ownership:** The spec mentions `nimbus.dev` via Cloudflare Registrar. Has the domain been purchased/secured yet? If not, procurement timing should account for potential registrar verification delays or premium pricing if the domain is on the secondary market.
- **GPG Key Management:** For a production release, even a preview, the GPG master key should ideally be kept offline (e.g., YubiKey or air-gapped machine) with only subkeys for signing in CI. 
    - **Suggestion:** Clarify in S0 if the `GPG_SIGNING_SUBKEY` in GitHub Secrets is a dedicated signing subkey and how the master key is protected.

## 2. UI & UX (Sections 4, 5, 6)

- **Marketplace First-Auth (S4):** Deferring "first-auth" to post-install invocation is pragmatically sound. However, if an extension fails immediately due to missing auth, it might feel "broken" to the user.
    - **Suggestion:** Add a "Setup Required" or "Configure" secondary action to installed extensions in the Marketplace tab to guide the user towards the connector flow.
- **Workflow Branching Visuals (S6):** The spec opts for a "step-list" view with indentation for branching.
    - **Question:** For complex nested branching, will indentation be sufficient for clarity? 
    - **Improvement:** Consider adding a "Visualize" read-only graph view (e.g., using Mermaid.js or a simple SVG generator) to give users a high-level view of the execution path without committing to a full interactive canvas.

## 3. Terminal & Editor Surfaces (Sections 7, 8, 9, 10)

- **TUI Terminal Compatibility (S7/S8):** `ink` works well in modern terminals (Windows Terminal, iTerm2, Kitty). Legacy Windows Console (`cmd.exe` / `conhost.exe`) often struggles with flexbox/layout.
    - **Suggestion:** Explicitly note if `nimbus tui` will detect and fall back to the simple REPL on legacy Windows consoles if layout breaks are detected.
- **VS Code on Cursor (S9/S10):** Cursor is a major target, but it often lags behind VS Code's latest API (e.g., `1.90.0` might be too new for the current Cursor stable build).
    - **Improvement:** Verify the minimum `engines.vscode` version supported by current stable Cursor and align the extension manifest to it.
- **VS Code Ask Tab (S10):** The spec uses an editor tab for responses. 
    - **Suggestion:** Ensure the Markdown tab is opened in a side-by-side view (Editor Group 2) by default so the user can continue looking at their code while the answer streams.

## 4. Release Hardening & Distribution (Section 11, 13)

- **SmartScreen Mitigation (S13):** If SmartScreen hard-blocks the `.exe` installer, shifting to "build from source" is a major barrier for a "wow" release.
    - **Suggestion:** Add a "Portable Zip" option. Frequently, a plain `.zip` containing the binaries (without an installer wrapper) triggers fewer SmartScreen "reputation" flags than a `.exe` installer.
- **SBOM Format:** The spec mentions CycloneDX.
    - **Suggestion:** Standardize on CycloneDX JSON (v1.5+) as it is more machine-readable and standard for modern security scanners than XML or older versions.
- **Update Mirroring:** `registry.nimbus.dev` mirrors the manifest.
    - **Question:** Is the registry mirror updated automatically by `release.yml`?
    - **Clarification:** Ensure the Cloudflare Pages deployment is triggered as part of the `release` environment approval flow.

## 5. Automation & Expressions (Sections 2, 3)

- **Expression Language Safety (A.2):** "No function calls, no arbitrary eval."
    - **Question:** Will basic string helpers like `contains()` or `trim()` be included? 
    - **Suggestion:** If S3 is strictly comparison-only (`==`, `!=`), the `when:` conditions might be very verbose. Consider a small whitelist of "Safe Pure Functions" if effort allows.

## 6. Project Management & Timeline

- **Parallelization:** The spec is strictly serial.
    - **Suggestion:** Sections 7/8 (TUI) and 9/10 (VS Code) are almost entirely independent from the Tauri UI (4/5/6) and could be parallelized if a second worker (or a subagent in a separate session) is available, potentially cutting 2-3 weeks off the "4-5 month" estimate.
- **Section 0 Success Gate:** "Branch protection blocks direct push."
    - **Note:** This is critical. Ensure the `release` environment also requires manual approval by the project owner to prevent automated token usage from shipping a binary without HITL.

## 7. Minor Corrections
- **S13/S14 Logic:** If a failure is found in S14 (Verification), it says "restart Section 14 from top."
    - **Clarification:** Ensure it explicitly mentions that a *new RC* must be cut (S13) before S14 restarts, as verification must be on the final immutable artifacts.
