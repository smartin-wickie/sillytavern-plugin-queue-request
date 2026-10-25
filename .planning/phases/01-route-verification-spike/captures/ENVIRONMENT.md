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
