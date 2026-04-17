window.BENCHMARK_DATA = {
  "lastUpdate": 1776395804144,
  "repoUrl": "https://github.com/asafgolombek/Nimbus",
  "entries": {
    "Nimbus Engine Benchmarks": [
      {
        "commit": {
          "author": {
            "email": "asafgolombek@gmail.com",
            "name": "AsafGolombek",
            "username": "asafgolombek"
          },
          "committer": {
            "email": "asafgolombek@gmail.com",
            "name": "AsafGolombek",
            "username": "asafgolombek"
          },
          "distinct": true,
          "id": "22f9eda302b1f0cfd84b8163d1ec47a94fec875c",
          "message": "Enhance branch protection documentation and improve benchmark workflow reliability\n\n- Updated `BRANCH_PROTECTION.md` to clarify required approvals and status checks for optimal OpenSSF Scorecard compliance.\n- Added a new section mapping Scorecard warnings to GitHub settings for better understanding of branch protection requirements.\n- Modified `benchmark.yml` to ensure reliable checkout of the branch that triggered the workflow, improving overall workflow stability.",
          "timestamp": "2026-04-17T00:08:51+03:00",
          "tree_id": "950e8b846f62d2ba623695d458f198dfb9863467",
          "url": "https://github.com/asafgolombek/Nimbus/commit/22f9eda302b1f0cfd84b8163d1ec47a94fec875c"
        },
        "date": 1776373789660,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.514434720000001,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "asafgolombek@gmail.com",
            "name": "AsafGolombek",
            "username": "asafgolombek"
          },
          "committer": {
            "email": "asafgolombek@gmail.com",
            "name": "AsafGolombek",
            "username": "asafgolombek"
          },
          "distinct": true,
          "id": "8a126afb23b7093b08aafd68f2e8db4f26a9e376",
          "message": "Refactor tar command resolution for Windows compatibility in local extension installation\n\n- Introduced `resolveSystemTarCommand` function to determine the appropriate tar command based on the operating system, ensuring compatibility with Windows paths.\n- Updated instances in `install-from-local.ts` and `install-from-local.test.ts` to utilize the new function for improved reliability in extracting and packing archives.",
          "timestamp": "2026-04-17T06:10:31+03:00",
          "tree_id": "d45a791c535737709e81316c48982dcef1fe4db4",
          "url": "https://github.com/asafgolombek/Nimbus/commit/8a126afb23b7093b08aafd68f2e8db4f26a9e376"
        },
        "date": 1776395467004,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.441821079999999,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "asafgolombek@gmail.com",
            "name": "AsafGolombek",
            "username": "asafgolombek"
          },
          "committer": {
            "email": "asafgolombek@gmail.com",
            "name": "AsafGolombek",
            "username": "asafgolombek"
          },
          "distinct": true,
          "id": "87072662313eed7c8d7895beaaef2ea22878cc5e",
          "message": "Fix environment variable access for Windows tar command resolution in local extension installation\n\n- Updated the way environment variables are accessed in the `resolveSystemTarCommand` function to use bracket notation for improved compatibility and clarity.",
          "timestamp": "2026-04-17T06:16:12+03:00",
          "tree_id": "d06929e49f2ebf8aeb62470f58eda70e3d28cf39",
          "url": "https://github.com/asafgolombek/Nimbus/commit/87072662313eed7c8d7895beaaef2ea22878cc5e"
        },
        "date": 1776395803549,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4424153800000028,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}