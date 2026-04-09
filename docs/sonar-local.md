# SonarCloud and local analysis

CI in this repository runs Biome, TypeScript, and tests; it does **not** run SonarScanner. SonarCloud analysis (for example via the SonarCloud GitHub app) uses separate rules. To match the server before opening a pull request, use **SonarLint** and optionally the **SonarScanner CLI**.

## SonarLint (recommended)

1. Install the [SonarLint](https://www.sonarsource.com/products/sonarlint/) extension in VS Code or Cursor.
2. Open **Connected Mode** and bind the workspace to your SonarCloud project (same `projectKey` as on [sonarcloud.io](https://sonarcloud.io)).
3. Fix issues SonarLint reports on the files you change; this aligns with the quality gate on **new code** in pull requests.

## SonarScanner CLI

1. Install a JRE and [SonarScanner](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-integration-overview/).
2. Set `sonar.organization` and `sonar.projectKey` in [`sonar-project.properties`](../sonar-project.properties) at the repo root (or override with `-Dsonar.organization=... -Dsonar.projectKey=...`).
3. Create a SonarCloud token (**My Account** → **Security**) and export it:

   ```bash
   export SONAR_TOKEN=your_token_here
   ```

4. From the repository root:

   ```bash
   sonar-scanner
   ```

   For a pull request, add [PR parameters](https://docs.sonarsource.com/sonarqube-cloud/enriching/branch-analysis/) so “new code” matches the PR, for example:

   ```bash
   sonar-scanner \
     -Dsonar.pullrequest.key=123 \
     -Dsonar.pullrequest.branch=my-branch \
     -Dsonar.pullrequest.base=main
   ```

5. Optional: after `bun run test:coverage`, point `sonar.javascript.lcov.reportPaths` at generated `lcov.info` files if your SonarCloud project is configured to import coverage.

## Notes

- Adjust `sonar.sources`, `sonar.tests`, or `sonar.typescript.tsconfigPath` in `sonar-project.properties` if SonarCloud reports missing files or wrong TypeScript context.
- Do not commit Sonar tokens; use environment variables or your CI secret store only.
