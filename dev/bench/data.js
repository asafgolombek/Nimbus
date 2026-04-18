window.BENCHMARK_DATA = {
  "lastUpdate": 1776495544951,
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
          "id": "9885183d4e4da0cf6e2075ec4b4a5e404c069dee",
          "message": "Update lock-threads action in GitHub workflow to use dessant repository for improved functionality",
          "timestamp": "2026-04-17T06:23:28+03:00",
          "tree_id": "20f6df3f806a66000701664a216dd6e67fa597b3",
          "url": "https://github.com/asafgolombek/Nimbus/commit/9885183d4e4da0cf6e2075ec4b4a5e404c069dee"
        },
        "date": 1776396242048,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5343725200000011,
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
          "id": "2d150ce71d77a8d331d3c2db6aa6af6366912b8b",
          "message": "Update documentation and restructure architecture references\n\n- Renamed `architecture.md` to `docs/architecture.md` and updated all references accordingly in various documentation files.\n- Added new `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` files to establish community standards and contribution guidelines.\n- Removed the obsolete `SECURITY.md` file and updated references to the new location in `docs/SECURITY.md`.\n- Enhanced clarity in documentation by ensuring consistent file paths and improving the overall structure of the documentation.",
          "timestamp": "2026-04-17T10:00:43+03:00",
          "tree_id": "48a1c25bc62edb46d98e24f3cbafc14110f12540",
          "url": "https://github.com/asafgolombek/Nimbus/commit/2d150ce71d77a8d331d3c2db6aa6af6366912b8b"
        },
        "date": 1776409271193,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4284623599999982,
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
          "id": "376afc87920e14fc44d71cbdc2a68800a7a8c46f",
          "message": "Update protobufjs version in package.json and bun.lock\n\n- Upgraded protobufjs from version 6.11.4 to 7.5.5 in both package.json and bun.lock files.\n- Added protobufjs override in package.json for consistent dependency management.",
          "timestamp": "2026-04-17T10:06:45+03:00",
          "tree_id": "02dc55331802a35519a8e60bab80190596f87214",
          "url": "https://github.com/asafgolombek/Nimbus/commit/376afc87920e14fc44d71cbdc2a68800a7a8c46f"
        },
        "date": 1776409633482,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4507588599999992,
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
          "id": "9f1f3f641f69ea94675afbdfc2992c512dfbf191",
          "message": "Update architecture and roadmap documentation for Phase 4 enhancements\n\n- Updated the model name in the architecture documentation to reflect the latest version.\n- Added detailed descriptions of new subsystems including Model Router and Multi-Agent Orchestration.\n- Introduced built-in agent workflows and clarified SQLite encryption options in the roadmap.\n- Enhanced overall structure and clarity of documentation to support Phase 4 development.",
          "timestamp": "2026-04-17T10:28:39+03:00",
          "tree_id": "b3d88a0d51723b5c571923d4f67b86e0882e22ad",
          "url": "https://github.com/asafgolombek/Nimbus/commit/9f1f3f641f69ea94675afbdfc2992c512dfbf191"
        },
        "date": 1776410950313,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4836202599999995,
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
          "id": "2cfa9c5ba595c83915930a02702a30b4e8fa7a5a",
          "message": "docs(plans): add WS1 Local LLM & Multi-Agent implementation plan\n\n14-task TDD plan covering Ollama provider, llama.cpp provider, GPU\narbitrator, LLM router, DB migrations V16+V17, LLM IPC dispatcher,\nengine.askStream, AgentCoordinator, and sub-agent executor.\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>",
          "timestamp": "2026-04-18T01:09:16+03:00",
          "tree_id": "7cd28af9d8eff7cd48068178a1746024f7a51327",
          "url": "https://github.com/asafgolombek/Nimbus/commit/2cfa9c5ba595c83915930a02702a30b4e8fa7a5a"
        },
        "date": 1776485894408,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.098447700000001,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "asafgolombek@gmail.com",
            "name": "Asaf",
            "username": "asafgolombek"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "95e364e2ca11b004dd228d973bdea91e80ff5c75",
          "message": "Merge pull request #48 from asafgolombek/dev/asafgolombek/general_code_review\n\nDev/asafgolombek/general code review",
          "timestamp": "2026-04-18T09:58:42+03:00",
          "tree_id": "66a00267bc5b6eec89b7b8f603a463f977c0919a",
          "url": "https://github.com/asafgolombek/Nimbus/commit/95e364e2ca11b004dd228d973bdea91e80ff5c75"
        },
        "date": 1776495544580,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4959961999999978,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}