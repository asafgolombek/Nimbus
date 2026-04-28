window.BENCHMARK_DATA = {
  "lastUpdate": 1777401393703,
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
          "id": "a64129deb094d5738d543478ddb07d6bd414d443",
          "message": "Merge pull request #57 from asafgolombek/dev/asafgolombek/phase_4_ws5\n\nDev/asafgolombek/phase 4 ws5",
          "timestamp": "2026-04-22T07:34:05+03:00",
          "tree_id": "ebeebfef1ce0c0187bd80420aefa043cddb37ef5",
          "url": "https://github.com/asafgolombek/Nimbus/commit/a64129deb094d5738d543478ddb07d6bd414d443"
        },
        "date": 1776832473129,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.502204440000001,
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
          "id": "62391b781b58dfb828789a9a6d2940d7871bbbe5",
          "message": "Merge pull request #77 from asafgolombek/dev/asafgolombek/phase4-s1-post-merge-status\n\ndocs: WS5-C merged — update Phase 4 status lines",
          "timestamp": "2026-04-22T07:46:09+03:00",
          "tree_id": "5304755847f9231f4c4625ed875c1d378c2ae0cd",
          "url": "https://github.com/asafgolombek/Nimbus/commit/62391b781b58dfb828789a9a6d2940d7871bbbe5"
        },
        "date": 1776833191591,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4691678799999999,
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
          "id": "a7380dc7790708d8a1c65128d74ffc3dce85ded8",
          "message": "Merge pull request #78 from asafgolombek/dev/asafgolombek/fix-macos-transparent\n\nfix(tauri): enable macOSPrivateApi for transparent Quick Query window",
          "timestamp": "2026-04-22T08:10:33+03:00",
          "tree_id": "962d587774dd2f1c463dd6947acad2df91edb9fb",
          "url": "https://github.com/asafgolombek/Nimbus/commit/a7380dc7790708d8a1c65128d74ffc3dce85ded8"
        },
        "date": 1776834662002,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.6260875799999963,
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
          "id": "9f140cc97f577c332cac37d1f5f7104aae3fb308",
          "message": "Merge pull request #68 from asafgolombek/dependabot/bun/scure/bip39-2.0.1\n\nchore(deps): bump @scure/bip39 from 1.6.0 to 2.0.1",
          "timestamp": "2026-04-22T08:54:02+03:00",
          "tree_id": "7519cff1110eb31f03249216ba693bf49ea62857",
          "url": "https://github.com/asafgolombek/Nimbus/commit/9f140cc97f577c332cac37d1f5f7104aae3fb308"
        },
        "date": 1776837268618,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.1383851600000008,
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
          "id": "bc394e8db4d64d918f6df4db05c8a30873e70aeb",
          "message": "Merge pull request #80 from asafgolombek/dev/asafgolombek/coverage-boost\n\ntest(ui): boost coverage — AuditFilterChips, restartApp, UpdaterRestartChrome",
          "timestamp": "2026-04-22T10:47:27+03:00",
          "tree_id": "5cfd556f32e1c954dd7972322633a5fc80c87080",
          "url": "https://github.com/asafgolombek/Nimbus/commit/bc394e8db4d64d918f6df4db05c8a30873e70aeb"
        },
        "date": 1776844077272,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4325209600000017,
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
          "id": "1314194df1412747350b6f4e92a01914af2af6fc",
          "message": "chore: remove obsolete project documentation files and update CLAUDE.md index",
          "timestamp": "2026-04-22T11:35:57+03:00",
          "tree_id": "1d21285481de4f3561dd70402fd3b05f985539ad",
          "url": "https://github.com/asafgolombek/Nimbus/commit/1314194df1412747350b6f4e92a01914af2af6fc"
        },
        "date": 1776846990789,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4344225600000005,
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
          "id": "3aea00f9625a432dd5a6153968d5ea45b8ddac8a",
          "message": "feat: introduce reusable CI test workflow and local test execution script to standardize test parity across environments",
          "timestamp": "2026-04-22T11:40:40+03:00",
          "tree_id": "960ccfb476857ee7590b9c6ef0d600217bddfc10",
          "url": "https://github.com/asafgolombek/Nimbus/commit/3aea00f9625a432dd5a6153968d5ea45b8ddac8a"
        },
        "date": 1776847270355,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4281386000000031,
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
          "distinct": false,
          "id": "b0afc473b06db3c827937271c5714e1756a5d4cf",
          "message": "docs(plan): Phase 4 §S2 — A.1 graph-aware watcher conditions implementation plan\n\nImplementation plan for Section 2 of the Phase 4 completion spec. Covers V22\nschema migration (renumbered from V20 because V20/V21 landed on main since\nthe spec was authored), graph-predicate evaluator, watcher-engine\nintegration, [automation].graph_conditions TOML flag, and the two new\nread-only IPC handlers (watcher.validateCondition, watcher.listCandidateRelations).\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-04-22T11:52:45+03:00",
          "tree_id": "53a632956a395edbc3dda729f772c5bdfb998103",
          "url": "https://github.com/asafgolombek/Nimbus/commit/b0afc473b06db3c827937271c5714e1756a5d4cf"
        },
        "date": 1776849200716,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.51939212,
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
          "id": "2e9693a219947a3c3ac325cb605183c7cd7db239",
          "message": "Merge pull request #81 from asafgolombek/dev/asafgolombek/phase4-s2-watcher-graph\n\nfeat: Phase 4 §S2 — A.1 graph-aware watcher conditions",
          "timestamp": "2026-04-22T18:27:54+03:00",
          "tree_id": "11466760b10f3a4520479472d55619f767a50de7",
          "url": "https://github.com/asafgolombek/Nimbus/commit/2e9693a219947a3c3ac325cb605183c7cd7db239"
        },
        "date": 1776871701625,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4153935400000024,
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
          "id": "ddfc14198acae8f0d0c1610b3d433eb1f9917b7f",
          "message": "Merge pull request #82 from asafgolombek/dev/asafgolombek/phase_4_finals\n\nDev/asafgolombek/phase 4 finals",
          "timestamp": "2026-04-22T18:32:30+03:00",
          "tree_id": "d3c67a0254bc64d657bbc9b081c263a086c6c1b9",
          "url": "https://github.com/asafgolombek/Nimbus/commit/ddfc14198acae8f0d0c1610b3d433eb1f9917b7f"
        },
        "date": 1776871982688,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4906131599999959,
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
          "id": "a318768a7787c2f70bab02404666402fbbfed428",
          "message": "feat: implement Watchers page and IPC infrastructure for graph-based condition monitoring",
          "timestamp": "2026-04-22T19:10:59+03:00",
          "tree_id": "8d07f30402a43aa41d74813307882da5c70a966f",
          "url": "https://github.com/asafgolombek/Nimbus/commit/a318768a7787c2f70bab02404666402fbbfed428"
        },
        "date": 1776874295831,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.480193799999999,
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
          "id": "4b64eabf26d1d8106084a9b062fa9f4933f779cb",
          "message": "Merge pull request #83 from asafgolombek/dev/asafgolombek/ws5d-polish\n\nfeat(ws5d-polish): watcher history, workflow run history + audit deep-link, \"Run with params...\"",
          "timestamp": "2026-04-23T07:22:54+03:00",
          "tree_id": "1301761e154ec12a4247b20600e40a4f200b76c0",
          "url": "https://github.com/asafgolombek/Nimbus/commit/4b64eabf26d1d8106084a9b062fa9f4933f779cb"
        },
        "date": 1776918197411,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4241878399999945,
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
          "distinct": false,
          "id": "bc48765ed528ecf63f4295aa0022e259de3727c2",
          "message": "docs(plan): address Gemini review of signing-pipeline plan\n\nOne real correctness bug fixed (I4): vanilla macOS ships shasum but\nNOT sha256sum, so the verify script's prereq probe would exit 2 on\nevery default Mac. nimbus-verify.sh now probes for sha256sum first,\nfalls back to shasum -a 256, uses $SHACMD throughout.\n\nOther inline fixes:\n- Task 3.3: base64 PNG write for autonomous icon (no ImageMagick dep)\n- Task 3.6: --help flag for package-linux-installers.ts\n- Task 6.1: explicit skip reason for missing pwsh\n- Task 9.1: Unblock-File for Zone.Identifier on .ps1\n- Task 13.7: clarifying comment on filename preservation\n- Task 7.1: shasum alternative + --ignore-missing/latest.json clarity\n- Task 14.5a: gh api check for release env protection_rules\n- Task 14.5b: three-way fingerprint consistency check\n\nFull Review Responses section added at the end of the plan.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-04-23T09:26:58+03:00",
          "tree_id": "0ac86bb051823bde98d40ad8f7f6a42765123375",
          "url": "https://github.com/asafgolombek/Nimbus/commit/bc48765ed528ecf63f4295aa0022e259de3727c2"
        },
        "date": 1776953933301,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5186582800000012,
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
          "id": "71ae333b0125cade50e52aac7b45537feab0c35c",
          "message": "Merge pull request #84 from asafgolombek/dev/asafgolombek/signing-pipeline\n\nfeat(release): v0.1.0 Phase-1 headless signing pipeline",
          "timestamp": "2026-04-23T19:21:28+03:00",
          "tree_id": "f2acf7097188f979ee307e11605f07b34e99ebd0",
          "url": "https://github.com/asafgolombek/Nimbus/commit/71ae333b0125cade50e52aac7b45537feab0c35c"
        },
        "date": 1776961320497,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5194307399999958,
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
          "id": "cd3f31b5ec6a5de5e59d97020aa4e9239eefeedc",
          "message": "Merge pull request #95 from asafgolombek/dependabot/bun/mastra/mcp-1.5.1\n\nchore(deps): bump @mastra/mcp from 1.5.0 to 1.5.1",
          "timestamp": "2026-04-23T20:34:47+03:00",
          "tree_id": "907a14e43aba97422b9c9083050a139bb9240eb7",
          "url": "https://github.com/asafgolombek/Nimbus/commit/cd3f31b5ec6a5de5e59d97020aa4e9239eefeedc"
        },
        "date": 1776965712692,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.440855479999999,
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
          "id": "bf74362431136b963741fdedd1bc5c559ce012d7",
          "message": "Merge pull request #94 from asafgolombek/dependabot/github_actions/googleapis/release-please-action-5.0.0\n\nchore(ci): bump googleapis/release-please-action from 4.4.1 to 5.0.0",
          "timestamp": "2026-04-23T20:35:00+03:00",
          "tree_id": "c9efd20b2742b3496fc077dbf0d2c72c74e9bccf",
          "url": "https://github.com/asafgolombek/Nimbus/commit/bf74362431136b963741fdedd1bc5c559ce012d7"
        },
        "date": 1776965728021,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5182885199999994,
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
          "id": "8a14bb0a499c845d83f84ceae65bcf74e91d3267",
          "message": "Merge pull request #93 from asafgolombek/dependabot/bun/react-router-dom-7.14.2\n\nchore(deps): bump react-router-dom from 7.14.1 to 7.14.2",
          "timestamp": "2026-04-23T20:35:14+03:00",
          "tree_id": "06e764d12a346cd93e032a6a955e0427d2b8d485",
          "url": "https://github.com/asafgolombek/Nimbus/commit/8a14bb0a499c845d83f84ceae65bcf74e91d3267"
        },
        "date": 1776965738530,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.492244279999996,
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
          "id": "525acebb32f76968bf95e3ffc174bf90f85e946f",
          "message": "Merge pull request #92 from asafgolombek/dependabot/github_actions/anchore/sbom-action-0.24.0\n\nchore(ci): bump anchore/sbom-action from 0.20.0 to 0.24.0",
          "timestamp": "2026-04-23T20:35:24+03:00",
          "tree_id": "05f91fed89f71497e24baf443f0376292b4e0c87",
          "url": "https://github.com/asafgolombek/Nimbus/commit/525acebb32f76968bf95e3ffc174bf90f85e946f"
        },
        "date": 1776965763529,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.1615813000000004,
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
          "id": "9ff27821cdc238f316242f9eae92b5e728b8efb5",
          "message": "Merge pull request #91 from asafgolombek/dependabot/github_actions/actions-573e9dcf4a\n\nchore(ci): bump the actions group with 3 updates",
          "timestamp": "2026-04-23T20:35:43+03:00",
          "tree_id": "cfc37b53fb7fb19879fa220027c61a498f570fc9",
          "url": "https://github.com/asafgolombek/Nimbus/commit/9ff27821cdc238f316242f9eae92b5e728b8efb5"
        },
        "date": 1776965775271,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4302316000000013,
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
          "id": "ab23c85f1acf9945d305155a83cbecff0b6db7da",
          "message": "Merge pull request #86 from asafgolombek/dependabot/bun/types-47407f7a58\n\nchore(deps): bump @types/bun from 1.3.12 to 1.3.13 in the types group",
          "timestamp": "2026-04-23T20:35:59+03:00",
          "tree_id": "fe0149585a80a504c20d2f5f6f4df86ad928a569",
          "url": "https://github.com/asafgolombek/Nimbus/commit/ab23c85f1acf9945d305155a83cbecff0b6db7da"
        },
        "date": 1776965792067,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4247819199999991,
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
          "id": "c6da294ba3c2187308a54f8db879a849efbc8c10",
          "message": "Merge pull request #87 from asafgolombek/dependabot/bun/astro-6.1.9\n\nchore(deps): bump astro from 6.1.8 to 6.1.9",
          "timestamp": "2026-04-23T20:36:13+03:00",
          "tree_id": "27398f67d76bb05a45d69daf8aca9f0070c89205",
          "url": "https://github.com/asafgolombek/Nimbus/commit/c6da294ba3c2187308a54f8db879a849efbc8c10"
        },
        "date": 1776965804061,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4343367800000077,
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
          "id": "2b3f5698f16eae4d6702b1b0920d1de2f7d65d98",
          "message": "Merge pull request #90 from asafgolombek/dependabot/bun/mastra/core-1.27.0\n\nchore(deps): bump @mastra/core from 1.25.0 to 1.27.0",
          "timestamp": "2026-04-23T20:37:06+03:00",
          "tree_id": "6b310adbbdd5216a214c44b0046d4470f20375ee",
          "url": "https://github.com/asafgolombek/Nimbus/commit/2b3f5698f16eae4d6702b1b0920d1de2f7d65d98"
        },
        "date": 1776965857996,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.625164880000001,
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
          "id": "e8ce66ebe52ebe87357f14826902d3d0d9832e94",
          "message": "Merge pull request #85 from asafgolombek/dependabot/bun/tooling-43049f4c06\n\nchore(deps): bump @biomejs/biome from 2.4.12 to 2.4.13 in the tooling group",
          "timestamp": "2026-04-23T20:37:24+03:00",
          "tree_id": "8ccf81305679e9e3f78e2c1989f1861be781520e",
          "url": "https://github.com/asafgolombek/Nimbus/commit/e8ce66ebe52ebe87357f14826902d3d0d9832e94"
        },
        "date": 1776965878240,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5264118000000009,
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
          "id": "1070179ff9c6914e2733c11d22e5294e58aff05b",
          "message": "docs(plan): address Gemini review of WS6 Rich TUI plan\n\nVerified two claims against the codebase before fixing:\n- createCliFileLogger already calls ensureGatewayDirs(paths); the mkdir\n  guard Item 6 suggested is already in place.\n- IpcContext.Provider sits in the top-level inkRender() call, not inside\n  a stateful React component; Item 1's useMemo concern does not apply\n  (runTui is an async function, not a component — JSX evaluates once).\n\nFixed inline:\n- Item 2 (cancel log): Task 14 handleCancelKey now emits logger.debug on\n  both the local-only cancel path (with streamId + \"LLM may continue\"\n  marker) and the double-Ctrl+C exit path.\n- Open Question 1 (SubTaskPane truncation): legitimate gap. New\n  SUBTASK_PANE_ROW_LIMIT = 8 constant (Task 2). SubTaskPane slices at\n  the limit and appends \"…N more (M total)\" (Task 11). Truncation test\n  added.\n- Open Question 2 (low-color-terminal smoke): Task 17 manual-smoke doc\n  gains §11 \"Low-color-terminal readability\" check.\n\nPushed back: Items 1 (useMemo — not applicable, verified), 4 (Esc key —\nout of spec scope, Ctrl+U would be more conventional anyway), 5\n(SubTask dim-on-completion — UX polish, not in spec). Defer all three.\n\nAlready-addressed: Items 3, 6, 7 — reviewer reinforced existing correct\nbehavior.\n\nReview response section appended to the plan with full reasoning for\neach item. Plan ready for execution.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-04-23T20:37:46+03:00",
          "tree_id": "4eb08fc0de8c3fba0e816a6075e7225ff4785ab2",
          "url": "https://github.com/asafgolombek/Nimbus/commit/1070179ff9c6914e2733c11d22e5294e58aff05b"
        },
        "date": 1776965919242,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5136885999999965,
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
          "id": "e0c842ae98710c6375793aa94176c104bc5bde33",
          "message": "Merge pull request #89 from asafgolombek/dependabot/bun/astrojs/starlight-0.38.4\n\nchore(deps): bump @astrojs/starlight from 0.38.3 to 0.38.4",
          "timestamp": "2026-04-23T20:38:19+03:00",
          "tree_id": "63ec18094eb0f6de98dabb2bcb9bb63078428c4c",
          "url": "https://github.com/asafgolombek/Nimbus/commit/e0c842ae98710c6375793aa94176c104bc5bde33"
        },
        "date": 1776965937685,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5068319000000026,
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
          "id": "78a3c2bfe5ad2061e6e1bd364102d3c49e843662",
          "message": "Merge pull request #88 from asafgolombek/dependabot/bun/multi-5ee397c873\n\nchore(deps): bump react-window and @types/react-window",
          "timestamp": "2026-04-23T20:38:32+03:00",
          "tree_id": "f143cf5c7ae92116e4cad8391104d9ae008e2118",
          "url": "https://github.com/asafgolombek/Nimbus/commit/78a3c2bfe5ad2061e6e1bd364102d3c49e843662"
        },
        "date": 1776965947041,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4362261999999988,
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
          "id": "85ade20bd48007da518c6764a36d2ea525ff2907",
          "message": "docs: add WS6 TUI file locations and coverage command to agent context",
          "timestamp": "2026-04-23T22:20:54+03:00",
          "tree_id": "38a2de1f46c679f9d425b5b46fc371e1a90b44e0",
          "url": "https://github.com/asafgolombek/Nimbus/commit/85ade20bd48007da518c6764a36d2ea525ff2907"
        },
        "date": 1776972951911,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4273046599999963,
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
          "id": "b1a93f10d5c8154d487f2fff8d3ea01ac1b9d962",
          "message": "Merge branch 'dev/asafgolombek/ws6-rich-tui'\n\n# Conflicts:\n#\tCLAUDE.md\n#\tGEMINI.md",
          "timestamp": "2026-04-23T22:57:35+03:00",
          "tree_id": "0f0f640e36378b0f1cb702b98fce27606e705db6",
          "url": "https://github.com/asafgolombek/Nimbus/commit/b1a93f10d5c8154d487f2fff8d3ea01ac1b9d962"
        },
        "date": 1776974286746,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5016697399999992,
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
          "id": "7d9c6a1bd60d8998ef1c890dbd806a3a3fca0211",
          "message": "docs(plans): apply WS7 plan-review feedback\n\nAddress the 12-point review in 2026-04-24-ws7-vscode-extension-review.md:\n\nPlan changes (4 fixed inline):\n- Task 14 esbuild.mjs: minify production bundles, isDev-gated\n  sourcemaps; webview always minified (loads on every panel open).\n- Task 16 ConnectionManager: add reconnectNow() bypassing the\n  backoff timer; idempotent if already connected.\n- Task 18 StatusBar: extend StatusBarInputs with degradedConnector\n  Names; tooltip lists specific connector names instead of just a\n  count, so users don't have to open chat to see what's broken.\n- Task 26 extension.ts: register nimbus.reconnect command; poll\n  Connectors collects names + count; manifest commands array gets\n  the new entry.\n- Task 9 / Task 10: add code comments clarifying HITL lifecycle on\n  cancel and the omit-vs-redact rule for transcript turns.\n\nAlready-covered points (re-confirmed in review reply):\n- Session store uses workspaceState (Task 21 + Task 26).\n- HITL toast-vs-modal default with hitlAlwaysModal opt-in\n  (Task 19/20).\n- Selection context with file path + line range (Task 25.1 test).\n- Empty state with Start Gateway CTA (Task 23.5).\n- nimbus-item: URI provider (Task 24 + Task 26.1 registration).\n- Integration test minimal by design (Task 27).\n- cancelStream HITL cleanup is implicit via AbortController +\n  iterator finally (now documented in Task 9).\n- Node 18 compat verified during plan-writing.\n\nDeferred (already deferred in design spec §13.1):\n- connector.onHealthChanged Gateway notification — orthogonal\n  Gateway-wide change; matches Tauri UI's polling pattern for now.\n\nAlso commit the review file itself for future reference.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-04-24T08:24:34+03:00",
          "tree_id": "41ea7a9f5f9a7a52498434e4fe089f7e93ace96c",
          "url": "https://github.com/asafgolombek/Nimbus/commit/7d9c6a1bd60d8998ef1c890dbd806a3a3fca0211"
        },
        "date": 1777008358501,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4255218000000003,
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
          "id": "54378f8aac751733d8e5f9401cf2633ce9195979",
          "message": "Merge pull request #98 from asafgolombek/fix/main-breakages\n\nfix: unblock main preflight (react-window v2 + ink/react-devtools-core)",
          "timestamp": "2026-04-25T08:28:49+03:00",
          "tree_id": "8a7e0d9a9a5b3fcd3160366999de7685dd8b5814",
          "url": "https://github.com/asafgolombek/Nimbus/commit/54378f8aac751733d8e5f9401cf2633ce9195979"
        },
        "date": 1777094963281,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5016006399999975,
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
          "id": "85dd4b94ade9a09049ebbe3a5f5705b267e3eb88",
          "message": "Merge pull request #99 from asafgolombek/dev/asafgolombek/upgrade_packages\n\nci: bump runner OS / Node 22 / Rust MSRV 1.95 / Tauri plugin patches",
          "timestamp": "2026-04-25T08:56:15+03:00",
          "tree_id": "743f3a86415810ea3b97cdd5f0acd75572697604",
          "url": "https://github.com/asafgolombek/Nimbus/commit/85dd4b94ade9a09049ebbe3a5f5705b267e3eb88"
        },
        "date": 1777096601399,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4509730599999955,
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
          "id": "5794419415c8b14742f2da27d653ba006de65b40",
          "message": "refactor: remove deprecated database connection module",
          "timestamp": "2026-04-25T12:26:52+03:00",
          "tree_id": "7cc6d3a95c01fa1b99741eb75239d4d92a5eb594",
          "url": "https://github.com/asafgolombek/Nimbus/commit/5794419415c8b14742f2da27d653ba006de65b40"
        },
        "date": 1777109263469,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.1022851599999979,
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
          "id": "2548f7d6dffe1b70eeacb9f2d5ee6b9f970159cd",
          "message": "docs: add architecture documentation, security audit findings, and implement tool execution engine",
          "timestamp": "2026-04-25T14:01:54+03:00",
          "tree_id": "4129caa8f09ec8821d141c948e234b3c126cf81f",
          "url": "https://github.com/asafgolombek/Nimbus/commit/2548f7d6dffe1b70eeacb9f2d5ee6b9f970159cd"
        },
        "date": 1777114947429,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4477367800000007,
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
          "id": "595b1821b0c7d3f65321b97b2c318c65e6aa8291",
          "message": "Merge pull request #112 from asafgolombek/dev/asafgolombek/fixing_security_issues\n\nfix(security): High-severity security fixes (G1–G5)",
          "timestamp": "2026-04-26T07:35:09+03:00",
          "tree_id": "990fc734a6593ddb8be6564a32a97bf062a7a2a8",
          "url": "https://github.com/asafgolombek/Nimbus/commit/595b1821b0c7d3f65321b97b2c318c65e6aa8291"
        },
        "date": 1777178132451,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4988830600000016,
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
          "id": "e93092efa8015f1849c2e58bda0be52b6b858548",
          "message": "docs: formalize phase 4 implementation plan and roadmap while updating test coverage gates and build documentation",
          "timestamp": "2026-04-26T07:45:50+03:00",
          "tree_id": "ce801655bf10f5fc83dac27e6206f03dbae44c9d",
          "url": "https://github.com/asafgolombek/Nimbus/commit/e93092efa8015f1849c2e58bda0be52b6b858548"
        },
        "date": 1777178783547,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5122827999999982,
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
          "id": "49889f354665f408a844b0466ab2b0c04b0e7a08",
          "message": "feat: add plan-design-reviewer skill and initial design review documentation",
          "timestamp": "2026-04-26T08:23:12+03:00",
          "tree_id": "81c4686f93eb91d09a67a9cb74eae5fa3b801aa2",
          "url": "https://github.com/asafgolombek/Nimbus/commit/49889f354665f408a844b0466ab2b0c04b0e7a08"
        },
        "date": 1777181028517,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4995295600000025,
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
          "id": "cf8a4284aff0420efa13a1f95a09d3139e3cacbc",
          "message": "Merge pull request #113 from asafgolombek/dev/asafgolombek/security-fixes-medium\n\nfix(security): Medium-tier security findings (PR 2 of 3)",
          "timestamp": "2026-04-26T11:10:28+03:00",
          "tree_id": "f5d25596aba3e8721595931f27f2a5ae2d5fcc88",
          "url": "https://github.com/asafgolombek/Nimbus/commit/cf8a4284aff0420efa13a1f95a09d3139e3cacbc"
        },
        "date": 1777191058813,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4974411999999955,
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
          "id": "4289b0177ea51500d2fbaaab220b67c921ab473c",
          "message": "feat: add CodeQL static analysis workflow for Rust and JS/TS",
          "timestamp": "2026-04-26T11:16:06+03:00",
          "tree_id": "b44f819b73466bbbe4ad27b4d78d77067561a03f",
          "url": "https://github.com/asafgolombek/Nimbus/commit/4289b0177ea51500d2fbaaab220b67c921ab473c"
        },
        "date": 1777191402792,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.2945210600000001,
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
          "id": "00a1be718f1d311765163c30f0b4b6f12ef31a6f",
          "message": "feat: implement data export/import/delete CLI commands, configure AI automation hooks, and add cargo-deny rules",
          "timestamp": "2026-04-26T11:36:08+03:00",
          "tree_id": "706e01b081d64ed71593321e7679f9c6057c0237",
          "url": "https://github.com/asafgolombek/Nimbus/commit/00a1be718f1d311765163c30f0b4b6f12ef31a6f"
        },
        "date": 1777192605962,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4956842600000022,
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
          "id": "443c634d3fbf24c181e490d319f72fc1acd595e1",
          "message": "feat: add utility to install extensions from local directories and archives with security validation",
          "timestamp": "2026-04-26T11:52:38+03:00",
          "tree_id": "f5de5672533f17b36cfa90c1faf936b853658faf",
          "url": "https://github.com/asafgolombek/Nimbus/commit/443c634d3fbf24c181e490d319f72fc1acd595e1"
        },
        "date": 1777193595270,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.6133165199999997,
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
          "id": "806453a7419f290ea4d26f2cb1d84cb3bec730bb",
          "message": "feat: implement security fixes for low-tier audit findings across gateway, vault, and application subsystems",
          "timestamp": "2026-04-26T12:29:18+03:00",
          "tree_id": "1ad46431ee3f301c8608e7495c572b79e1d26cba",
          "url": "https://github.com/asafgolombek/Nimbus/commit/806453a7419f290ea4d26f2cb1d84cb3bec730bb"
        },
        "date": 1777195792196,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.503556179999996,
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
          "id": "14f52bed8cab6e63a0cf84ac5af80914e476a02f",
          "message": "Merge pull request #114 from asafgolombek/dev/asafgolombek/security-fixes-low\n\nfix(security): Low-tier security findings (PR 3 of 3)",
          "timestamp": "2026-04-26T15:39:43+03:00",
          "tree_id": "c16d5b5c1b006273dee96dfcdb452d18ec3f22c2",
          "url": "https://github.com/asafgolombek/Nimbus/commit/14f52bed8cab6e63a0cf84ac5af80914e476a02f"
        },
        "date": 1777207208706,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4850863599999997,
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
          "id": "f68e962cfe82628e610fda3c3c17e56cb79a18c8",
          "message": "Merge branch 'main' of github.com:asafgolombek/Nimbus",
          "timestamp": "2026-04-26T16:28:56+03:00",
          "tree_id": "a49d8726c841a4dce272517e5183c773341eb5e8",
          "url": "https://github.com/asafgolombek/Nimbus/commit/f68e962cfe82628e610fda3c3c17e56cb79a18c8"
        },
        "date": 1777210164340,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.495105020000002,
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
          "id": "145a90befb5a77b9c247c1aec3c1044200671a79",
          "message": "Merge pull request #115 from asafgolombek/dev/asafgolombek/perf-audit\n\nfeat(perf): B2 Phase 1A — bench harness scaffolding + S2-a proof driver",
          "timestamp": "2026-04-26T21:33:59+03:00",
          "tree_id": "e5e55679bd58692b7c2451673fd4733d3d69be55",
          "url": "https://github.com/asafgolombek/Nimbus/commit/145a90befb5a77b9c247c1aec3c1044200671a79"
        },
        "date": 1777228461861,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4268478999999996,
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
          "id": "4ae0a23ced08ca494a2a596d8e920ee881c2486e",
          "message": "",
          "timestamp": "2026-04-26T21:49:13+03:00",
          "tree_id": "0dca9f0e74db1c597c9957c48f57a8f12dcd2ce3",
          "url": "https://github.com/asafgolombek/Nimbus/commit/4ae0a23ced08ca494a2a596d8e920ee881c2486e"
        },
        "date": 1777229390273,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.4791695400000002,
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
          "id": "e9c4f414785a5c831db91810bf3f54ac5f7b7e15",
          "message": "docs(plans): apply Phase 1B review notes 1, 2, 4, 5; defer 3\n\n- Note 1: spawnAndTimeToMarker now races proc.exited so a child crash\n  pre-marker fails fast instead of hanging until timeout.\n- Note 2: S11-a/b switched from 'nimbus diag --json' to 'nimbus help' —\n  no gateway dependency, no health-check I/O jitter, smoke Pass A runs\n  cleanly without a started gateway.\n- Note 3: buffer cap in readUntilMatch deferred — YAGNI for early-firing\n  markers; revisit if a cluster C verbose-output surface needs it.\n- Note 4: driver failure records per-surface 'driver-failed: ...' via\n  the existing stub_reason field rather than line-level incomplete: true,\n  so other successful surfaces on the same line stay valid for delta\n  comparisons. Adds surfaceDriverOverrides deps hook + test.\n- Note 5: TUI first-frame marker moved from tui.tsx (fires before first\n  commit) to a useEffect inside App.tsx (fires after first commit),\n  env-gated on NIMBUS_BENCH=1; S4 driver sets that env when spawning.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-04-26T22:18:22+03:00",
          "tree_id": "26fbd1b82b606b3ca35d2eeb4200fd0872adb317",
          "url": "https://github.com/asafgolombek/Nimbus/commit/e9c4f414785a5c831db91810bf3f54ac5f7b7e15"
        },
        "date": 1777302273523,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.503895059999998,
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
          "id": "7f3d9bfee43205bdd9cb1f44d1b266d3259bf70c",
          "message": "Merge pull request #116 from asafgolombek/dev/asafgolombek/perf-audit-phase-1b\n\nperf(B2): Phase 1B — 8 surface drivers + UX SLO sheet (PR-B-2a)",
          "timestamp": "2026-04-27T20:34:16+03:00",
          "tree_id": "c5cf9295a78f89030341c8e56a98ab411cee27c4",
          "url": "https://github.com/asafgolombek/Nimbus/commit/7f3d9bfee43205bdd9cb1f44d1b266d3259bf70c"
        },
        "date": 1777311289752,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5534812400000062,
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
          "id": "16acfcd1a3bef9d62b9c3ab7d3ab547373ac19ef",
          "message": "feat: implement performance audit Cluster-C workload drivers and supporting infrastructure",
          "timestamp": "2026-04-27T21:29:05+03:00",
          "tree_id": "10866d222f7aaecacc53aae2b0986574d4ee73ab",
          "url": "https://github.com/asafgolombek/Nimbus/commit/16acfcd1a3bef9d62b9c3ab7d3ab547373ac19ef"
        },
        "date": 1777314599167,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5214447000000006,
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
          "id": "e14610b020997e31014e4445e7568cbbd37231fc",
          "message": "feat: implement cluster C performance drivers and supporting benchmarking infrastructure for sync throughput and RSS monitoring",
          "timestamp": "2026-04-27T22:05:29+03:00",
          "tree_id": "3c125001d003710b0f9f3bb9e5271069a87985a8",
          "url": "https://github.com/asafgolombek/Nimbus/commit/e14610b020997e31014e4445e7568cbbd37231fc"
        },
        "date": 1777316766891,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5251615599999997,
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
          "id": "bb2d4b845fb2faefb0b18220e609d3afb34105d7",
          "message": "Merge pull request #117 from asafgolombek/dev/asafgolombek/perf-audit-cluster-c-1\n\nfeat(perf): cluster-C drivers — S6 sync throughput + S7 RSS (PR-B-2b-1)",
          "timestamp": "2026-04-28T16:48:49+03:00",
          "tree_id": "ba6ef2f12ab3b32f63120398f67ef96fff125296",
          "url": "https://github.com/asafgolombek/Nimbus/commit/bb2d4b845fb2faefb0b18220e609d3afb34105d7"
        },
        "date": 1777384168061,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5028390199999933,
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
          "id": "0d3b96aff1bff195368cd47acb70a7cc1fb4b7be",
          "message": "Merge pull request #124 from asafgolombek/dev/asafgolombek/sonar-cleanup\n\nrefactor: clear all 30 SonarCloud findings on main",
          "timestamp": "2026-04-28T17:45:12+03:00",
          "tree_id": "00bd8c1060f70d6d6544ec5df681c0eeaad3e801",
          "url": "https://github.com/asafgolombek/Nimbus/commit/0d3b96aff1bff195368cd47acb70a7cc1fb4b7be"
        },
        "date": 1777387550322,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5055828999999954,
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
          "id": "5ea0c7a049f8f3cf8f079608089c4ae03fdc16ff",
          "message": "docs: create implementation and review plans for cluster C performance audit drivers",
          "timestamp": "2026-04-28T19:50:08+03:00",
          "tree_id": "776ac32bc4b36cd63b1ff3bcb102acfef0d6affe",
          "url": "https://github.com/asafgolombek/Nimbus/commit/5ea0c7a049f8f3cf8f079608089c4ae03fdc16ff"
        },
        "date": 1777395054555,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5080780400000027,
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
          "id": "2645218e05e1cb6a51879c499d1ba93ef29a69b2",
          "message": "Merge pull request #125 from asafgolombek/dev/asafgolombek/autid_c2\n\nperf: PR-B-2b-2 — S8/S9/S10 drivers + worker-bench",
          "timestamp": "2026-04-28T21:36:05+03:00",
          "tree_id": "bf6dda7ff875889cdbf0192579bffde2eafc5ed6",
          "url": "https://github.com/asafgolombek/Nimbus/commit/2645218e05e1cb6a51879c499d1ba93ef29a69b2"
        },
        "date": 1777401393055,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Structured Item Query Latency",
            "value": 1.5099333800000005,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}