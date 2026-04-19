window.BENCHMARK_DATA = {
  "lastUpdate": 1776608921804,
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
          "id": "3b43f5ca135319c5ac037e0109605acf66876610",
          "message": "Merge pull request #49 from asafgolombek/dev/asafgolombek/phase_4_workstream_1\n\nfeat(phase4): WS1 — Local LLM routing, GPU arbitration, multi-agent coordinator, engine.askStream",
          "timestamp": "2026-04-18T17:23:32+03:00",
          "tree_id": "fc0f4dc63e792862274cf90e23bc7245103c332e",
          "url": "https://github.com/asafgolombek/Nimbus/commit/3b43f5ca135319c5ac037e0109605acf66876610"
        },
        "date": 1776522242910,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4892394800000022,
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
          "id": "8f7a9fc08ff1a4a0dfeae4b80220826519ac1749",
          "message": "feat: enhance GEMINI and architecture documentation with Phase 4 updates\n\n- Updated GEMINI.md to include new OAuth token resolution methods, connector health state machine, and database management features.\n- Expanded architecture.md with new tables for LLM model registry and multi-agent sub-task results, along with additional fields for error handling and context window tracking.",
          "timestamp": "2026-04-18T17:35:36+03:00",
          "tree_id": "5870eda8a4010375d785b6fb7e57a332c48611fd",
          "url": "https://github.com/asafgolombek/Nimbus/commit/8f7a9fc08ff1a4a0dfeae4b80220826519ac1749"
        },
        "date": 1776522969637,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4360673199999996,
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
          "id": "3879cca7628d3d8e30366332e7ff5d1ae9f5e4f3",
          "message": "feat(voice): implement voice interface with STT, TTS, and wake word detection\n\n- Added a new voice interface implementation plan, including a local voice pipeline with Whisper.cpp for speech-to-text, platform-native text-to-speech, and wake word detection.\n- Created necessary types and interfaces for voice providers, along with unit tests for the new functionality.\n- Modified the configuration to include a new `[voice]` section for voice-related settings.\n- Integrated voice handlers into the existing IPC server for seamless communication.",
          "timestamp": "2026-04-18T18:28:18+03:00",
          "tree_id": "1f4337fb5305392dafd78b187010b509e5db950b",
          "url": "https://github.com/asafgolombek/Nimbus/commit/3879cca7628d3d8e30366332e7ff5d1ae9f5e4f3"
        },
        "date": 1776526127200,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4236627600000025,
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
          "id": "88b9c0739c99e55c83cbdebe3f2a4c1b266c22d7",
          "message": "Merge pull request #50 from asafgolombek/release-please--branches--main--components--nimbus\n\nchore(main): release 1.0.0",
          "timestamp": "2026-04-18T18:34:30+03:00",
          "tree_id": "bc3c45fd8945a78f0962a9d6fe6d53d878cc6984",
          "url": "https://github.com/asafgolombek/Nimbus/commit/88b9c0739c99e55c83cbdebe3f2a4c1b266c22d7"
        },
        "date": 1776526491619,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.7773300399999965,
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
          "id": "6affa303b3c6223511bcb68c0acf79a6389227cc",
          "message": "feat(voice): enhance local voice pipeline with microphone state management and configuration updates\n\n- Improved the `VoiceService` to include a microphone arbiter that manages audio device contention during manual queries.\n- Added `MicrophoneStateEvent` type to notify UI of microphone activity, ensuring user awareness of recording status.\n- Introduced `wakeWordWhisperModel` configuration to optimize CPU usage for wake word detection.\n- Updated IPC server to handle new microphone state notifications and integrated unit tests for the `VoiceService` and related components.",
          "timestamp": "2026-04-18T19:02:16+03:00",
          "tree_id": "442f79cb42ede9c5cdcedcdfc0ed6ab0c8f772f8",
          "url": "https://github.com/asafgolombek/Nimbus/commit/6affa303b3c6223511bcb68c0acf79a6389227cc"
        },
        "date": 1776528181779,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4976804600000013,
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
          "id": "b955818f71d2c209633bd0e0e0e1c984a20bd7d1",
          "message": "Merge pull request #51 from asafgolombek/release-please--branches--main--components--nimbus\n\nchore(main): release 1.1.0",
          "timestamp": "2026-04-18T19:17:02+03:00",
          "tree_id": "a6595f973acce0aefde3e301c604b24f62b9f2cd",
          "url": "https://github.com/asafgolombek/Nimbus/commit/b955818f71d2c209633bd0e0e0e1c984a20bd7d1"
        },
        "date": 1776529045710,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.1421170599999995,
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
          "id": "37b6b8242900ce656916b563a21a07acfe63dae7",
          "message": "Merge pull request #52 from asafgolombek/dev/asafgolombek/phase_4_ws_2\n\nfeat(voice): implement local voice pipeline (Phase 4 WS2)",
          "timestamp": "2026-04-18T21:19:58+03:00",
          "tree_id": "d825120876a726dfbc96f1dce788c068b2a4e7d1",
          "url": "https://github.com/asafgolombek/Nimbus/commit/37b6b8242900ce656916b563a21a07acfe63dae7"
        },
        "date": 1776536422652,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.10025424,
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
          "id": "074303317dfcd665be2a7f537c8c9081140f6562",
          "message": "feat(voice): enhance voice interface with new service and IPC handlers\n\n- Added `VoiceService` for speech-to-text (STT) and text-to-speech (TTS) functionalities, integrating `whisper-cli` and `NativeTtsProvider`.\n- Implemented `dispatchVoiceRpc` for handling voice-related IPC methods.\n- Updated documentation to reflect the new voice service architecture and configuration requirements.\n- Included checks in the CLI for voice-related dependencies when enabled.",
          "timestamp": "2026-04-18T21:31:47+03:00",
          "tree_id": "593e6f3eadc128b0449fb4f210b74eac1f0d365a",
          "url": "https://github.com/asafgolombek/Nimbus/commit/074303317dfcd665be2a7f537c8c9081140f6562"
        },
        "date": 1776537137499,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4242888999999996,
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
          "id": "b4af1d6a92f1356d2b2fd66dff8fc438f1e8b781",
          "message": "Merge pull request #53 from asafgolombek/dev/asafgolombek/_phase_4_ws_3\n\nfeat(phase-4-ws3): data sovereignty — export/import/delete, audit chain, connector reindex",
          "timestamp": "2026-04-19T07:20:34+03:00",
          "tree_id": "11be6e7131fae716ddc6028e986e591887ddc1cf",
          "url": "https://github.com/asafgolombek/Nimbus/commit/b4af1d6a92f1356d2b2fd66dff8fc438f1e8b781"
        },
        "date": 1776572463184,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4938129399999986,
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
          "id": "1be4f9b2d2c3225e468ddb28c3d2937c080bcd0a",
          "message": "chore(data-sovereignty): remove outdated implementation plan document\n\nDeleted the WS3 Data Sovereignty Implementation Plan document as it is no longer relevant. This change cleans up the repository by removing obsolete files.",
          "timestamp": "2026-04-19T08:44:34+03:00",
          "tree_id": "d2a22efb20b7565523ddb8e5e09ab104ca8fd935",
          "url": "https://github.com/asafgolombek/Nimbus/commit/1be4f9b2d2c3225e468ddb28c3d2937c080bcd0a"
        },
        "date": 1776577511151,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4980125400000008,
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
          "id": "e099242b1616a81df49e1e02eaa96941b5e79608",
          "message": "Merge pull request #54 from asafgolombek/dev/asafgolombek/phase_4_ws_4\n\nfeat(phase-4): WS4 Release Infrastructure — signing, auto-update, Plugin API v1, LAN remote access",
          "timestamp": "2026-04-19T11:39:35+03:00",
          "tree_id": "142a7b01b80d6cb7bedf76774e61a24007871ec5",
          "url": "https://github.com/asafgolombek/Nimbus/commit/e099242b1616a81df49e1e02eaa96941b5e79608"
        },
        "date": 1776588000585,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.501023019999999,
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
          "id": "57fc7d0f3e599e78b949bec1a951f0cefb6b7a21",
          "message": "chore(logging): add comments to clarify logging behavior in data import and updater functions",
          "timestamp": "2026-04-19T13:24:16+03:00",
          "tree_id": "9c095bb0d2a73a151561c48bd8067d074e1b5696",
          "url": "https://github.com/asafgolombek/Nimbus/commit/57fc7d0f3e599e78b949bec1a951f0cefb6b7a21"
        },
        "date": 1776594285419,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4349271999999984,
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
          "id": "f3715b197fc6deac4a0efc9641094ddffd4d1aac",
          "message": "chore: update .gitignore to include superpowers brainstorming artifacts and enhance security documentation in README and SECURITY.md",
          "timestamp": "2026-04-19T14:27:10+03:00",
          "tree_id": "3837f662eedea11e3761cc55a82dc1e025804871",
          "url": "https://github.com/asafgolombek/Nimbus/commit/f3715b197fc6deac4a0efc9641094ddffd4d1aac"
        },
        "date": 1776598059796,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.492538620000003,
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
          "id": "e60b679a753018e269484b33da72024ae8361f07",
          "message": "Merge pull request #55 from asafgolombek/dev/ws5a-app-shell\n\nfeat(ui): WS5-A — App Shell Foundation",
          "timestamp": "2026-04-19T17:28:09+03:00",
          "tree_id": "274b41889d8bc3478afeef411375019913feef01",
          "url": "https://github.com/asafgolombek/Nimbus/commit/e60b679a753018e269484b33da72024ae8361f07"
        },
        "date": 1776608920885,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.6879661399999997,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}