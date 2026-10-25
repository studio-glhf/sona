# Sona interface review

Review date: 9 October 2026, Asia/Seoul. Application version: 1.1.0.

**Findings**

No actionable P0, P1, or P2 visual finding remains in the examined states.
The source design establishes the layout. The user's later request establishes the quieter style and removal of the two notice surfaces.

The implementation uses the existing three columns. It retains the API controls and four evidence tabs.
The empty Notes panel has one short message. The Settings form has one project-key field.

## Source and capture

The selected visual reference is [the researcher figure](docs/prd/images/researcher-workspace-v1.0.png).
The user's later screenshot shows the previous application on macOS Chrome.
This review also uses [a fresh baseline capture](docs/verification/workspace-baseline-v1.0.0.png) from the preserved 1.0.0 archive.

The current application capture is [workspace-refined-1440.png](docs/verification/workspace-refined-1440.png).
The source figure is 1487 × 1058 pixels and includes a window frame.
The baseline and current captures are 1440 × 1024 pixels. Their CSS viewport is 1440 × 1024 with device scale factor 1.

Both application captures show a new agent, default parameters, no API key, Researcher view, and an idle call.
The parameter panel starts at its top. The source concept shows an active example call.
Those state and frame differences prevent a precise pixel comparison with the concept.

The [full comparison](docs/verification/design-comparison-full.png) places the baseline and current captures together.
Each capture is displayed at half size. The [control comparison](docs/verification/design-comparison-controls.png) uses unscaled regions from both captures.
The [concept comparison](docs/verification/design-comparison-target.png) shows the reference and current application together at half size.

## Visual surfaces

| Surface | Examined result |
|---|---|
| Fonts and type | Clear heading, control-label, and helper-text hierarchy. The system font stack supports each operating system. Linux glyphs differ from macOS. No proprietary OpenAI font is claimed. |
| Spacing and layout | The sidebar uses quiet selections. The voice controls form a compact group. Soft input corners and consistent gaps reduce form density. The evidence area has no empty rating form. |
| Colors | Neutral dark surfaces, white active controls, and muted supporting text replace repeated blue accents. Blue remains in the existing voice image and keyboard focus. Semantic error colors remain available. |
| Image and icons | The existing raster voice image remains intact. It is sharp at its displayed size. Lucide icons retain a consistent stroke. No replacement image or decorative CSS drawing was introduced. |
| Copy | The application uses direct labels. The key form explains memory storage and separate API billing. Technical parameter details remain in disclosures. The old Data policy editor and Voice processing notice are absent. |

## Other states and access

The captures include [Settings](docs/verification/settings-refined-1440.png), [empty Notes](docs/verification/notes-empty-refined-1440.png), and [Participant view](docs/verification/participant-refined-1280.png).
The [1280-width workspace](docs/verification/workspace-refined-1280.png) keeps the session controls and parameter panel available.
Its navigation opens through the menu. The document has no horizontal overflow.

At 640 pixels, the [parameter drawer](docs/verification/controls-refined-640.png) opens above the workspace.
This is an intentional overlay. Its close control remains available. A narrower viewport does not establish mobile-device voice support.

The full browser suite passes nine workflows. It covers navigation, drafts, revisions, study setup, device-dialog access, and optional Participant view.
It also covers key entry, removal, safe errors, refresh failure, and a held draft save.
The quick-test request has no processing-notice acceptance flag.

The rendered screen review found no console errors. Automated Settings accessibility checks found no violations in the selected WCAG tags.
The original workspace accessibility check also passes. These results do not establish complete WCAG conformity.
Physical screen-reader, native zoom, microphone, speaker, and user-observation checks remain separate.

## Review history

The first integrated GUI workflow found stale access status after key removal and a failed workspace refresh.
The repair applies accepted key status immediately. A scoped refresh preserves pending drafts.
The isolated workflow and all nine combined workflows pass after the repair.

The first comparison used a historical baseline image with a different panel scroll position.
A fresh baseline capture replaced it before visual acceptance. The matched comparison shows the same parameter state.

## Implementation checklist

- The key form uses protected local server routes.
- The key does not enter browser storage or saved study records.
- Researcher view remains the default.
- Participant view exposes no transcript or visual agent answer.
- The live configuration stays fixed while draft controls remain available.
- The refined captures and browser result files are included in the release evidence.

**Follow-up polish**

A physical macOS review can examine the system-font rendering and native device selectors.
The compact drawer close control can receive further visual refinement after laptop use.
These are P3 improvements. They do not block the examined layout.

final result: passed

## Settings feedback review — 9 October 2026

Application version: `1.1.1`. The earlier review above applies to version `1.1.0`.

The selected dark layout remains unchanged. Both result areas stay beside the control that starts the check.
The key check uses a quiet status dot and short result text. Only verified access has a green dot.
Failure text does not expose provider or browser diagnostics. Retry stays available after a failed check.
The Devices dialog shows microphone progress and recovery guidance in an accessible live region.

Actual Chromium captures:

- [Verified key result, 1440 pixels](docs/verification/settings-key-verified-fixture-1440.png).
- [Verified key result, 1280 pixels](docs/verification/settings-key-verified-fixture-1280.png).
- [Rejected key result](docs/verification/settings-key-rejected-fixture-1440.png).
- [Microphone result](docs/verification/microphone-success-fixture-1440.png).

The main agent inspected these rendered screens. Spacing, text, status, and controls remain readable.
Automated accessibility checks pass for the key-result page and microphone dialog in the selected WCAG tags.
The captures use explicit response and media fixtures. They do not prove a live key or physical microphone result.

## Workspace management and inspector update — 2026-10-25

The existing sidebar, session actions, and controls panel were reviewed in the running app before changes. The review found no sidebar item actions, a destructive session button detached from evidence, a fixed inspector width, and insufficient space beside the inspector scrollbar.

Implemented item menus for agents, studies, and sessions with Rename, Pin/Unpin, and confirmed Delete. Agent/study names update their current records; session names are organizational metadata. Recorded snapshots are unchanged. Pin preferences survive server restart. Older sessions can be expanded with Show all sessions. Referenced agents remain protected; deleting a study clearly confirms its cascading local-data deletion.

The session Delete action now sits in a separated record-action row below evidence. The inspector has a collapse/expand control and pointer/keyboard resizing, with persistent browser preferences. The scrollable panel reserves scrollbar space and adds inner padding. Phone drawers use a dimmed backdrop and can close through the header, backdrop, or Escape.

Validation: TypeScript and production build pass; 177 unit/integration tests and all 32 Chromium workflows pass. New workflows cover name/pin persistence, protected and successful deletions, session-action placement, dragging, keyboard resizing, persisted width/collapse, and responsive overflow/spacing. Visual checks used synthetic data in the in-app browser. Saved responsive screenshots were inspected at 375, 768, 1024, 1440, and 1920 pixels wide. Automated accessibility checks are bounded to their tested rules and do not establish full accessibility compliance.

Screenshots: `docs/verification/sidebar-controls-375.png`, `sidebar-controls-768.png`, `sidebar-controls-1024.png`, `sidebar-controls-1440.png`, and `sidebar-controls-1920.png`.

The rapid-navigation test was corrected to wait for the new-agent creation response and matching heading before editing. Its earlier intermittent failure read the previous agent's name while creation was still pending; the trace showed that the edited new agent's draft had actually saved correctly.

## Audio device lifecycle repair — 2026-10-25

Addressed recurring microphone-loss reports, unbounded live speaker switching, and permission checks opening competing captures. Named built-in device rows resolve to system-default aliases when enumeration identifies the same hardware. Active checks reuse working capture or repair ended capture. Input replacement commits only after capture and sender replacement succeed, preserving current input on failure. Output switching uses a three-second deadline and a fresh system-output player on failure, without awaiting an unbounded playback promise. Cleanup cancels pending microphone acquisition and isolates late startup, device, playback, and end results from newer sessions. Intentional cleanup detaches old track-ended handlers. Permission feedback describes pending browser requests without assigning a hardware fault.

Validation: TypeScript and production build pass; 181 unit/integration tests pass. New browser regressions exercise live capture reuse, built-in input/output aliases, repair after simulated track loss, preserved input after failed replacement, stalled speaker fallback, and a canceled connection failing after its successor connects. Existing microphone-dialog tests still cover permission failures and late-stream release. These use synthetic media and cannot establish physical audio quality.

Physical Chrome check: selected MacBook Pro Speakers (Built-in) without an idle UI freeze. The idle microphone request timed out. Native inspection then reported the Mac was locked; the user was asked to unlock it. Physical mic/speaker playback verification remains pending and must not be reported as passed. The frontend has been rebuilt in place without restarting the credential-holding server.

Final automated result: all 34 Chromium workflows passed after adding credential cleanup to the new isolated audio fixture. The two audio lifecycle workflows passed again against the final rebuilt frontend. Build, type checking, and diff whitespace validation pass. The running Chrome tab was reloaded to the final frontend and left ready for the unlocked physical test.

### Unlocked live follow-up

After the user unlocked the Mac, the built-in microphone permission probe succeeded immediately in Chrome. Session `7225cc` connected with all 13 configured fields confirmed. During the live session, permission checks succeeded immediately; output switched System output -> MacBook Pro Speakers (Built-in) without freezing; input switched built-in -> system -> built-in without a loss notice. Actual input speech/transcription and automatic model responses appeared. Browser evidence included playback.ready before and after the output choices, and provider evidence included output_audio_buffer.started/stopped. Audible speaker confirmation was requested from the user; generated speech/playback evidence alone is not proof of sound heard in the room.

The user confirmed hearing Sona respond through the built-in speakers and seeing the transcript. The live session ended cleanly after 47 seconds. The reported permission-check delay and built-in-speaker freeze did not recur in this unlocked test. No external audio device, system audio-service restart, or API-key replacement was needed.
