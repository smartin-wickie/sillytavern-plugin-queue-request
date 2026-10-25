# Route spike

Preserved, re-runnable evidence for the R1 vs R2 generation-route decision. It is not production code and is not the
starting point for the real extension.

## Install (directory junction)

From Git Bash:

```
cmd //c mklink //J "E:\SillyTavern\public\scripts\extensions\third-party\qs-route-spike" "D:\repositories\sillytavern-plugin-queue-request\spike"
```

Edits to `spike/` are then live in ST after a page reload. If ST does not discover the cross-drive junction, copy the
folder into `third-party/qs-route-spike` instead.

## Remove

Remove the junction with `rmdir` only, which deletes the link and leaves the repo files alone:

```
cmd //c rmdir "E:\SillyTavern\public\scripts\extensions\third-party\qs-route-spike"
```

Never use a recursive delete on the junction path.

## Use

The spike refuses to run unless the active character is named `QS Spike Throwaway`, the chat is not a group, and the
last message is from the AI. All methods are on `window.qsSpike`:

- `capture({label, holdMs, withSignal})` idle-gated dry-run `Generate('swipe')` with an own abort signal; dumps `queued` and `snapshot`
- `send({label, holdForAbort})` own transport for the last capture, handles generator and JSON shapes; dumps `transport` (or `abort`)
- `abortOwn()` aborts only the spike's own request
- `armNative({label})` records the prompt of the next native generation; dumps `native`
- `overlap({withSignal, holdMs})` holds a dry-run capture open so a manual message can be sent; result in `window.qsSpike.pending` and an `overlap` dump
- `status()` version, backend, streaming, auto_swipe settings, interceptor extensions
- `note(key, value)` operator observations, dumped as `qs-notes.json`
- `snapshot()`, `dump(name, obj)`, `guard()`

## Dumps

Names follow `qs-<cc|tc>-<stream|nostream>[-label]-<queued|native|transport|snapshot|overlap|abort>.json`. They are
written through `/api/files/upload` to `E:\SillyTavern\data\default-user\user\files\`, with `proxy_password`,
`custom_include_headers`, `api_key` and `custom_url` redacted.

## Tools

- `node spike/tools/check-exports.mjs [root]` confirms every import in `st-imports.js` is exported by the installed ST
- `node spike/tools/diff-captures.mjs <queued.json> <native.json>` strict prompt diff; exits 1 on any difference
