# Phase 5 Compatibility Matrix (COMP-01)

Session: 2026-10-28, SillyTavern 1.19.0 'release' (06bde939f) at http://127.0.0.1:8000/, Chrome driven by Claude in Chrome.

## Method

- **Backend:** LM Studio (local, custom OpenAI-compatible endpoint on 127.0.0.1:5000), model `satyr-v0.1-4b`. Zero spend.
- **Chat:** throwaway character "QS Spike Throwaway" only. No real chats touched.
- **Order (D-03):** baseline with every third-party extension except Queued Swipes disabled, then one extension enabled at a time (reload after each change), then one combined run with Prompt Inspector disabled.
- **Pass bar (D-02):** every queued item appends a swipe; pager total grows by the number queued; no console errors from either extension; the other extension still does its own job.
- **Install under test:** the ST copy at `data/default-user/extensions/queued-swipes` is a plain copy, not a junction. Its runtime files were synced from the repo at 05-01 HEAD (gap warner included) before testing.
- **User decisions for this session (2026-10-28):** do not install UserSwipes or any other swipe plugin; keep queue and swipe plugins disabled during testing to avoid compatibility issues. Deep-Swipe, Swipe Pregeneration, Swipe browse-all, Swipe Sculpt and Guided Generations stay disabled for every row.
- Original state snapshot: `evidence/state-snapshot.json`.

## Results

| extension | version/commit | case | result | notes | evidence |
|-----------|----------------|------|--------|-------|----------|
| Queued Swipes alone | 0.1.0 (repo 7f4949d) | baseline | PASS | 3 queued; swipes 6 -> 9, pager 6/9 (swipe_id unchanged at 5); swipe_info length 9; completion toast "3 queued swipe(s) completed."; 0 console errors. Gap toast shown once on the first queue click (Image Generation, Vector Storage interceptors, bundled), not on clicks 2 and 3. ~1 min per item (long outputs). | evidence/baseline-pager.jpg |
| Deep-Swipe | 1.5.4 | solo | BLOCKED | Installed but kept disabled per user decision 2026-10-28 (disable swipe/queue plugins to avoid compatibility issues). Not tested. | - |
| UserSwipes | not installed | solo | BLOCKED | Not installed; user declined installing it or any other swipe plugin (2026-10-28). | - |
| Prompt Inspector | 1.1.0 | solo, installed + inspector disabled (localStorage `promptInspectorEnabled`='false') | PASS | 2 queued; swipes 9 -> 11, pager 6/11, swipe_id unchanged; swipe_info 11; 0 console errors. Inspector stays dormant ("Inspect Prompts" menu entry present, no popup on queued dry runs). Item 2 was a short model reply (18 chars, real output with reasoning), not an error. | evidence/prompt-inspector-disabled.jpg |
| MessageSummarize (qvink_memory) | 1.3.29 | solo (interceptor `memory_intercept_messages`, auto_summarize on) | PASS | 2 queued; swipes 11 -> 13, pager 6/13, swipe_id unchanged; 0 console errors. Queued appends did not trigger qvink auto-summarize (no qvink data written to the target message). Own job check: `/qm-summarize 24` then `/qm-get 24` returned a fresh summary via LM Studio. Interceptor not applied to queued items (documented gap). | evidence/messagesummarize.jpg |
| Parameter Randomizer | 1.0.0 | solo (interceptor `randomizerInterceptor`; its own toggle off, no controls configured) | PASS | 2 queued; swipes 13 -> 15, pager 6/15, swipe_id unchanged; 0 console errors. Own job check limited: settings UI loaded, `randomizerInterceptor` callable without error. Randomization itself not exercised (user has it off with no controls). Interceptor not applied to queued items (documented gap). | evidence/randomizer.jpg |
| WebSearch | 1.2.0 | solo (interceptor `WebSearch_Intercept`; source serpapi, not configured with a key) | PASS | 2 queued; swipes 15 -> 17, pager 6/17, swipe_id unchanged; 0 console errors. Own job check limited: `WebSearch_Intercept` runs on a copy of the chat without error; no live search (no key; would not run anyway). Interceptor not applied to queued items (documented gap). | evidence/websearch.jpg |
| TTS (bundled `tts`) | ST 1.19.0 bundled | solo (TTS enabled, provider System, auto_generation on) | BLOCKED | Queue side passes: 2 queued; swipes 17 -> 19, pager 6/19, swipe_id unchanged; 0 console errors; `speechSynthesis.speak` was called 0 times while queued items appended, so TTS does not read queued swipes. Own job check blocked: the user's voice map has "[Default Voice]" = disabled, so `/speak` produced no speech. Configuring a voice was not done to avoid changing the user's TTS setup. TTS enable was turned back off after the row. | evidence/tts.jpg |
| Summarize (bundled `memory`) | ST 1.19.0 bundled | solo (source main, auto interval 0) | PASS | 2 queued; swipes 19 -> 21, pager 6/21, swipe_id unchanged; 0 console errors. Own job check: `/summarize source=main <text>` ran end to end through LM Studio after the queue drained and returned text (the 4B model ignored the summary instruction, which is a model-quality issue, not an extension one). | evidence/summarize.jpg |
| Vector Storage (bundled `vectors`) | ST 1.19.0 bundled | solo (loaded in every row; chat vectorization not configured) | BLOCKED | The extension was loaded in every row, so queue coexistence is covered: its interceptor shows in the gap toast and no errors occurred. The injection check is blocked: the user has never configured Vector Storage (empty settings), and enabling it would need an embedding source or model download. Not changed. | - |
| combined: Prompt Inspector (disabled) + MessageSummarize + Parameter Randomizer + WebSearch + bundled TTS/Summarize/Vector Storage loaded | as above | combined | PASS | Fresh tab. 3 queued; swipes 21 -> 24, pager 6/24, swipe_id unchanged at 5; swipe_info 24; 0 console errors. TTS enable left at the user's original value (off). Deep-Swipe and other swipe/queue plugins stayed disabled per user decision. | evidence/combined.jpg |
| Queued Swipes gap toast | 0.1.0 | gap-toast: first queue action in a tab warns once | PASS | Baseline tab: one toast on the first click naming Image Generation, Vector Storage. Combined tab: one toast naming "Image Generation, Vector Storage, Parameter Randomizer, WebSearch, qvink_memory". Non-modal; the item was queued both times. | evidence/gap-toast-new-tab.jpg |
| Queued Swipes gap toast | 0.1.0 | gap-toast: second queue action in same tab does not warn | PASS | Clicks 2 and 3 in both tabs added items with no second gap toast (toast count stayed 1); queueing succeeded each time. Same tab across page reloads also stayed silent (sessionStorage per tab). | evidence/gap-toast-new-tab.jpg |
| Queued Swipes gap toast | 0.1.0 | gap-toast: new tab warns again | PASS | After closing the first tab, a new tab warned again on its first queue action. | evidence/gap-toast-new-tab.jpg |
| Queued Swipes gap toast | 0.1.0 | gap-toast: no gaps active shows no toast | PASS | Every interceptor-declaring extension disabled (bundled stable-diffusion and vectors, plus Randomizer, WebSearch, MessageSummarize); auto_swipe off; squash off. Fresh tab, first queue click: 0 toasts in `#toast-container`, item queued (0/1) and appended (swipes 24 -> 25). The tab group closed during the drain, so the screenshot was taken after the drain in a new tab (pager 6/25). | evidence/gap-toast-no-gaps.jpg |

restored: `extension_settings.disabledExtensions` was set back to the 12-entry snapshot list (Queued Swipes, Deep-Swipe, WebSearch and Randomizer disabled again; Swipe Pregeneration, Swipe browse-all, Swipe Sculpt, Guided Generations, MessageSummarize and Prompt Inspector enabled again, as before the session). The custom model was set back to `dark-desires-32b-v1.5` and TTS enable to off. Checked after a reload. auto_swipe, auto_continue and squash were never changed. `promptInspectorEnabled` stayed 'false' throughout.

## Summary

- **PASS: 11.** Baseline, Prompt Inspector (disabled), MessageSummarize, Parameter Randomizer, WebSearch, Summarize, combined, and the four gap-toast rows.
- **FAIL: 0.**
- **BLOCKED: 4.**
  - Deep-Swipe and UserSwipes: the user decided no swipe plugins would be tested or installed.
  - TTS: no voice is configured, so the own-job check could not run. The queue side was clean.
  - Vector Storage: never configured, so the injection check did not run. Queue coexistence is covered.

Queue behaviour held in every run: every queued item appended exactly one swipe, `swipe_info` stayed parallel, `swipe_id` never moved, and there were no console errors from Queued Swipes or any other extension. Across the session 18 swipes were appended to the throwaway message (6 -> 25, including one in the no-gaps check).

Gap for ROADMAP criterion 1: Deep-Swipe and UserSwipes are not proven compatible. Both rows are BLOCKED by the user's instruction for this session.
