# Changelog

## [1.1.0](https://github.com/asafgolombek/Nimbus/compare/v1.0.0...v1.1.0) (2026-04-18)


### Features

* **voice:** enhance local voice pipeline with microphone state management and configuration updates ([6affa30](https://github.com/asafgolombek/Nimbus/commit/6affa303b3c6223511bcb68c0acf79a6389227cc))

## 1.0.0 (2026-04-18)


### Features

* **config:** add [llm] TOML section parser and NimbusLlmToml type ([8b0900b](https://github.com/asafgolombek/Nimbus/commit/8b0900bfe1db0d870767d85e3fa3828b60df787b))
* **db:** add V16 migration — llm_models table and context_window_tokens column ([9865861](https://github.com/asafgolombek/Nimbus/commit/98658612ae2d2d53220d741a1c2ba7ebe318e4ef))
* **db:** add V17 migration — sub_task_results table for multi-agent persistence ([9ee893e](https://github.com/asafgolombek/Nimbus/commit/9ee893e65aeac1b7ef54cf3b5cf4e912951a6be6))
* **engine:** add AgentCoordinator — multi-agent sub-task orchestration with depth and tool-call guards ([ada9c31](https://github.com/asafgolombek/Nimbus/commit/ada9c312e7bb197a9008fe5a54e480ae380a7b29))
* **engine:** add runSubAgent — sub-task executor with sub_task_results DB lifecycle ([5812244](https://github.com/asafgolombek/Nimbus/commit/58122447b5259a6cb7753702ee328b90dc30e8dc))
* enhance GEMINI and architecture documentation with Phase 4 updates ([8f7a9fc](https://github.com/asafgolombek/Nimbus/commit/8f7a9fc08ff1a4a0dfeae4b80220826519ac1749))
* **ipc:** add engine.askStream — streaming agent response via engine.streamToken/Done/Error notifications ([79f1e97](https://github.com/asafgolombek/Nimbus/commit/79f1e975c60fcccc27ff45103a0a7eb44150df25))
* **ipc:** add llm.* RPC dispatcher (listModels, getStatus) wired into IPC server ([10e1ec8](https://github.com/asafgolombek/Nimbus/commit/10e1ec8e5be1bcefdc0aa0a1494ccd2e04cbc7ba))
* **llm:** add GpuArbiter — single-slot GPU mutex with activity timeout ([e9caea5](https://github.com/asafgolombek/Nimbus/commit/e9caea5927d84c734d4df73dfc641dc0a42a58a6))
* **llm:** add LlamaCppProvider wrapping llama-server HTTP API ([106d409](https://github.com/asafgolombek/Nimbus/commit/106d409273a95a2a4d7c69fd91bb7e980d2da8c0))
* **llm:** add LlmProvider interface and task type definitions ([8e02102](https://github.com/asafgolombek/Nimbus/commit/8e021021b72bf7ac982d8e3ba632e8c3dcd79112))
* **llm:** add LlmRegistry — model discovery + llm_models DB sync ([4fabb29](https://github.com/asafgolombek/Nimbus/commit/4fabb299b4d5e51b614970ac47a1e4a12d3921f9))
* **llm:** add LlmRouter — provider selection with air-gap and preference config ([102f4c7](https://github.com/asafgolombek/Nimbus/commit/102f4c7650c1563ff8ace9bbd10ac809ad5a1a99))
* **llm:** add OllamaProvider with batch and streaming generation ([b49ace7](https://github.com/asafgolombek/Nimbus/commit/b49ace7370c6a11cf2674800cbd7e3425039808d))
* **llm:** enhance model lifecycle management and streaming capabilities ([7e88d56](https://github.com/asafgolombek/Nimbus/commit/7e88d56dbfc6558ec3cee5f77e3fb4dd6e61a1c1))
* **voice:** implement voice interface with STT, TTS, and wake word detection ([3879cca](https://github.com/asafgolombek/Nimbus/commit/3879cca7628d3d8e30366332e7ff5d1ae9f5e4f3))


### Bug Fixes

* **db:** use explicit target version in migration tests, restore runner throw for unknown versions ([9b4e2d3](https://github.com/asafgolombek/Nimbus/commit/9b4e2d391cc7a343fb77a9a5fdf29635eb646864))
