# Spike Environment

## Task 1 outcome (server check)
Orchestrator found PID 48348 (`node server.js`, 127.0.0.1:8000). The user closed it themselves ("closed"). Re-check of `netstat -ano | grep -E ":(8000|8001) .*LISTENING"` showed no listeners. No process was stopped by the executor.

## SillyTavern
- Path: E:\SillyTavern, branch `release`
- Before: `1.14.0-9-g765c76ea8`; `git status --short` was ` M package-lock.json` and `?? StartPort8001.bat`
- Action: `git checkout -- package-lock.json`, `git pull origin release`, `npm install --no-audit --no-fund` (210 added, 8 removed, 48 changed)
- `git describe --tags`: `1.19.0-1-g06bde939f`
- `git rev-parse HEAD`: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
- package.json: `"version": "1.19.0"`
- `git rev-list --left-right --count 1.19.0...HEAD`: `0	1` (release is 1 commit ahead of the 1.19.0 tag)
- node: v22.17.0
- After: `git status --short` shows only untracked `StartPort8001.bat`; data/ untouched; no backup made (D-02)

## Baseline to restore (D-07)
Read-only from E:\SillyTavern\data\default-user\settings.json (no secrets read).
- `extension_settings.disabledExtensions` (verbatim): `["translate","expressions"]`
- `main_api`: `"openai"`
- `oai_settings.preset_settings_openai`: `"Default32k"`
- `textgenerationwebui_settings.preset`: `"Mistral-V7-Tekken-T8-XML"`
- `power_user.instruct.preset`: `"Sphiratrioth - LLAMA 3"`

### User extensions (data/default-user/extensions, 26 folders) with generate_interceptor
| Folder | generate_interceptor |
|---|---|
| Extension-CodeMirror | none |
| Extension-CodeRunner | none |
| Extension-CustomSliders | none |
| Extension-Dice | none |
| Extension-EmojiPicker | none |
| Extension-ImageMetadataViewer | none |
| Extension-LaTeX | none |
| Extension-Mermaid | none |
| Extension-Notebook | none |
| Extension-Objective | none |
| Extension-PromptInspector | none |
| Extension-QuickContextSize | none |
| Extension-QuickPersona | none |
| Extension-Randomizer | randomizerInterceptor |
| Extension-SamplerCommands | none |
| Extension-TopInfoBar | none |
| Extension-WebSearch | WebSearch_Intercept |
| GuidedGenerations-Extension | none |
| SillyTavern-Character-Creator | none |
| SillyTavern-Custom-Scenario | none |
| SillyTavern-MessageSummarize | memory_intercept_messages |
| SillyTavern-Roadway | none |
| SillyTavern-Timelines | none |
| SillyTavern-Variable-Viewer | none |
| SillyTavern-WI-Bulk-Mover | none |
| SillyTavern-WorldInfo-Recommender | none |

## llama.cpp
- Binary: E:\text-generation-webui\installer_files\env\Lib\site-packages\llama_cpp_binaries\bin\llama-server.exe
- `--version`: `version: 1 (ff55414)`, built with MSVC 19.44.35219.0 for x64; CUDA device 0: NVIDIA GeForce RTX 4090 (cc 8.9)
- `--help` mentions `--jinja`: yes (3 matching lines)
- Preferred model: D:\old-models\Chat\dolphin-2.9-llama3-8b.Q8_0.gguf (8541301056 bytes, present). Other Llama-3 candidates in the same folder: L3-8B-Stheno-v3.1-Q8_0-imat.gguf, Llama-3-Soliloquy-8B-v2-Q8_0-imat.gguf.
- Planned ports: llama-server 8080, ST 8001.

## Spike session setup
Started by the orchestrator (inline, plan 01-04 Task 1) on 2026-10-25. LM Studio model was unloaded by the user first; VRAM before start: 3230 / 24564 MiB.

- llama-server command: `E:\text-generation-webui\installer_files\env\Lib\site-packages\llama_cpp_binaries\bin\llama-server.exe -m "D:\old-models\Chat\dolphin-2.9-llama3-8b.Q8_0.gguf" --host 127.0.0.1 --port 8080 -c 8192 -ngl 99 --jinja`
- ST command: `node server.js --port 8001` (cwd E:\SillyTavern); startup log prints `SillyTavern 1.19.0` and lists `third-party/qs-route-spike` as a global extension
- llama-server PID: 55716
- ST PID: 29100
- Model id (/v1/models): `D:\old-models\Chat\dolphin-2.9-llama3-8b.Q8_0.gguf`
- Smoke tests: /health `{"status":"ok"}`; CC POST /v1/chat/completions 200 ("Hi there! How can I assist you today?"); TC POST /completion 200 (non-empty text; raw prompt without template gives off-topic output, expected)
- ST URL: http://127.0.0.1:8001/ (HTTP 200)
- Spike junction: `E:\SillyTavern\public\scripts\extensions\third-party\qs-route-spike` -> `D:\repositories\sillytavern-plugin-queue-request\spike` (repointed from the 01-02 worktree after merge)
- Other local services during the spike: Ollama on 127.0.0.1:11434 (untouched)

### Operator GUI setup (plan 01-04 Task 2)
- UI shows `SillyTavern 1.19.0 'release' (06bde939f)`. `GET /version`: `{"agent":"SillyTavern:1.19.0:Cohee#1207","pkgVersion":"1.19.0","gitRevision":"06bde939f","gitBranch":"release","isLatest":true}`
- Character `QS Spike Throwaway` (single, not group) created; one exchange in chat, last message from AI. World Info entry with keyword trigger, Sticky 3.
- Connections: CC Custom `http://127.0.0.1:8080/v1`; TC llama.cpp `http://127.0.0.1:8080`. Presets temperature 0, response length 64, no logprobs; CC "Squash system messages" OFF.
- Spike fix found here: `qsSpike.status()` used `POST /version`, but ST serves `GET /version` (src/server-main.js:272), so `version` came back null. Fixed in spike/index.js to plain `fetch('/version')`.
- Disabled extensions after setup (26, all user extensions; bundled ones left on, so the original `translate`/`expressions` entries are not in this list):
  `third-party/Extension-CustomSliders, third-party/Extension-EmojiPicker, third-party/Extension-ImageMetadataViewer, third-party/SillyTavern-MessageSummarize, third-party/Extension-Dice, third-party/Extension-Objective, third-party/Extension-PromptInspector, third-party/SillyTavern-Timelines, third-party/Extension-Randomizer, third-party/Extension-WebSearch, third-party/Extension-TopInfoBar, third-party/Extension-CodeMirror, third-party/Extension-CodeRunner, third-party/Extension-LaTeX, third-party/Extension-Mermaid, third-party/Extension-Notebook, third-party/Extension-QuickContextSize, third-party/Extension-QuickPersona, third-party/Extension-SamplerCommands, third-party/GuidedGenerations-Extension, third-party/SillyTavern-Character-Creator, third-party/SillyTavern-Custom-Scenario, third-party/SillyTavern-Roadway, third-party/SillyTavern-Variable-Viewer, third-party/SillyTavern-WI-Bulk-Mover, third-party/SillyTavern-WorldInfo-Recommender`

`qsSpike.status()` output (before the /version fix):
```json
{
  "version": null,
  "mainApi": "textgenerationwebui",
  "streaming": true,
  "auto_swipe": false,
  "auto_swipe_minimum_length": 0,
  "auto_swipe_blacklist": [],
  "auto_swipe_blacklist_threshold": 2,
  "interceptors": [
    { "name": "stable-diffusion", "fn": "SD_ProcessTriggers", "loaded": true },
    { "name": "vectors", "fn": "vectors_rearrangeChat", "loaded": true },
    { "name": "third-party/Extension-Randomizer", "fn": "randomizerInterceptor", "loaded": false },
    { "name": "third-party/Extension-WebSearch", "fn": "WebSearch_Intercept", "loaded": false },
    { "name": "third-party/SillyTavern-MessageSummarize", "fn": "memory_intercept_messages", "loaded": false }
  ]
}
```
`qsSpike.snapshot()` returned an object. No module import error.
Note: bundled `stable-diffusion` and `vectors` interceptors are loaded (they run on every non-dry generation); Vectors is not enabled for the chat per operator.
