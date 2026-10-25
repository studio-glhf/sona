# Sona local setup

Sona uses one browser application and one local server. An internet connection is necessary for OpenAI and external tools. There is no hosting subscription.

The release evidence is in [readiness.md](../verification/readiness.md). A successful browser test does not prove microphone or speaker operation on a laptop.

## Before installation

- Install Node **24.19.0** and pnpm **11.19.0**.
- Use desktop Chrome. Windows and macOS are the target systems. See the evidence record for completed device tests.
- Use your own OpenAI API project. A ChatGPT subscription does not pay for API calls.
- For Calendar tools, use an authorized Google account and a designated test calendar.

Do not put credentials or participant records in the repository. Do not send secrets in chat. The browser does not need a permanent API key.

## Install and start

1. Extract the local release archive.
2. Open a terminal in its `sona-<version>` directory.
3. Do the locked installation:

```sh
pnpm install --frozen-lockfile
```

4. Start the built application:

```sh
pnpm start
```

5. Open `http://127.0.0.1:4317` in Chrome.

Keep the terminal open during use. To stop the server, press Ctrl+C. A restart keeps saved drafts and study records. It does not start microphone capture.

The source checkout also needs a build before the first start:

```sh
pnpm build
pnpm start
```

## OpenAI API key

Start Sona without an environment file. Open **Settings**, enter your OpenAI project API key, then select **Save key**.

Sona holds the key in local server memory until the server stops. It does not save the key in the browser, the study database, configurations, logs, or exports.
The form clears after submission. It shows the key's verification status; it does not return the key.

Saving checks the format, then requests OpenAI's model list. The check does not generate a model response.
**API key verified** means OpenAI accepted the key for this request. Voice access and billing need separate checks.
**API key rejected** means OpenAI returned an authentication error. Replace the key with an active project key.
**Could not verify** means permission, network, or service conditions prevented the check. It does not establish that the key is invalid.
Select **Check key** to try again. Each check has a ten-second limit and no automatic retry.

To replace or remove the key, first end active tests and API operations. Select **Remove key** to disable OpenAI access for the current run.
Removing a key also disables any legacy environment seed. It does not fall back to that seed until a server restart.

A browser reload keeps the current server key. A server restart removes GUI-entered keys. Enter your key again in **Settings**.
A ChatGPT subscription does not cover API usage. Use a project key, not an administrative key.

### Optional server credentials

The GUI is the normal route for Sona's project key. Existing command-line installations can still supply `OPENAI_API_KEY` to the server.
This is optional. The independent example runtime also uses its own server-side credentials.

The example file `.env.example` lists optional variable names. It contains no credentials. Sona does not automatically read a repository `.env` file.
Keep any private environment file outside the repository. To use one:

```sh
node --env-file=/absolute/private/path/sona.env dist/server.mjs
```

On Windows, give the full private file path. Put quotation marks around paths that contain spaces. Restrict file access to your user account.

| Variable               | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`       | Optional legacy project key seed, or the independent runtime's project access.  |
| `OPENAI_PROJECT_ID`    | Optional OpenAI project selection.                                              |
| `OPENAI_ADMIN_KEY`     | Separate optional credential for administrative operations.                     |
| `GOOGLE_CLIENT_ID`     | Your OAuth application's client identifier.                                     |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret, when the client type needs one.                            |
| `GOOGLE_CALENDAR_ID`   | Designated test resource. Tool permissions also restrict the calendar argument. |
| `SONA_PORT`            | Local server port. Default: `4317`.                                             |
| `SONA_WEB_PORT`        | Development browser port. Default: `5173`.                                      |
| `SONA_DATA_DIR`        | Optional application-data path outside the checkout.                            |

No connection from the coding assistant transfers to Sona. Use Sona's supported sign-in route. Do not copy ChatGPT cookies or runtime tokens.

## First use

1. Open **Settings**, enter your project API key, and select **Save key**.
2. Open **Devices** and select the microphone.
   Select **Check microphone permission** to test access. The dialog shows the result and releases the temporary microphone stream.
3. Select the output, if Chrome permits output selection.
4. If the selector shows **System output**, select the output in the operating system.
5. Add an agent or import `sona-agent.json`.
6. Add the necessary connection in **Connections**.
7. Select **Start quick test**.

A quick test keeps live evidence in memory. It saves the configuration snapshot and a redacted action journal for recovery. Raw audio is not saved.

A study run needs a participant code, an assigned condition, and applicable consent. This rule also applies when the researcher is the participant.

Each run saves its task, research question, rating definitions, and condition with the configuration snapshot.
Later study edits do not change these records. Comparisons keep different protocol snapshots separate.

Researcher view is the default. **Participant view** is optional. It hides research evidence but does not create a separate account or security boundary.

## Calendar connection

The published Google Calendar plugin points to `https://calendarmcp.googleapis.com/mcp/v1`. The marketplace page is not the MCP endpoint.

1. Create or select an OAuth application that permits your intended accounts.
2. Configure its permitted callback for this Sona installation.
3. Supply its client values to the local server.
4. Add the Google Calendar connection in Sona.
5. Complete the provider sign-in.
6. Discover the tool definitions.
7. Select only the necessary tools.
8. Bind each applicable resource field to the designated test calendar.
9. Block attendees and invitations for the initial tests.

Use the callback shown by Sona's connection flow. The default port is `4317`. A different port changes the callback.

The default callback is `http://127.0.0.1:4317/api/oauth/callback`. The portable runtime uses its own callback on port `4320`.

The published plugin manifest lists more scopes than Sona's initial request. Sona requests selected Calendar scopes and identity access.
Actual scope acceptance, endpoint audience, and account policy still need verification. Do not substitute the manifest's credential placeholders for your client values.

OAuth tokens stay in server memory. Restarting the server can require new sign-in. Connection definitions and permissions remain saved.

Google and organization policy can restrict an OAuth grant. For an external OAuth app in Testing, refresh tokens can expire after seven days. See [Google's guidance](https://github.com/googleapis/google-api-nodejs-client#handling-refresh-tokens).

If a compatible Codex app-server is available, Sona can attempt its documented connection route. Tool discovery does not prove that an existing ChatGPT grant works.

The connection must pass a real read and approved write before a reuse claim. If a new Google grant is necessary, record it as new authorization.

## Storage and deletion

| System            | Default data directory                          |
| ----------------- | ----------------------------------------------- |
| Windows           | `%LOCALAPPDATA%\Sona`                           |
| macOS             | `~/Library/Application Support/Sona`            |
| Linux development | `$XDG_DATA_HOME/Sona`, or `~/.local/share/Sona` |

The study database is `sona.sqlite`. `SONA_DATA_DIR` can select another private directory. The server rejects a data directory inside the checkout.

Saved records have a 30-day retention period by default. Cleanup occurs at startup and during operation. It cannot run while Sona is stopped.

The GUI has no Data policy editor. The server keeps its existing retention and deletion rules.
Sona can reuse study agreement when participant code, study protocol, scope, and retention still match. Session agreement applies to one session only.
The researcher can withdraw consent from the session evidence panel. Capture stops for sessions that use that consent record.

Delete selected studies or sessions through Sona. Exports, backups, provider records, and Calendar events are separate copies or resources. Local deletion is not forensic erasure.

For a backup, stop Sona first. Copy the complete data directory to a private location. To restore it, stop Sona and restore that directory.

Do not restore an older database over a newer running release. Keep a backup before upgrades. The server rejects a database migration version it cannot read.

## Commands

| Command               | Purpose                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`            | Start the server and browser development processes.                           |
| `pnpm build`          | Build the production browser files and local server.                          |
| `pnpm start`          | Start the built local application.                                            |
| `pnpm check`          | Do TypeScript checks.                                                         |
| `pnpm test`           | Do unit and integration tests.                                                |
| `pnpm test:e2e`       | Do local browser tests with an isolated data directory.                       |
| `pnpm test:live`      | Report live prerequisites. Exit code 2 means verification is blocked.         |
| `pnpm coverage:api`   | Make the operation coverage report.                                           |
| `pnpm example:agent`  | Use the portable agent runtime. See its usage instructions.                   |
| `pnpm package`        | Make a local archive, file manifest, and SHA-256 checksum.                    |
| `pnpm verify:release` | Examine the archive and do a clean local installation with synthetic records. |

For browser tests outside the supplied cloud environment, install Chromium with `pnpm exec playwright install chromium`. Set `SONA_CHROMIUM_PATH` only to an existing browser executable.

The supplied cloud environment uses these installation settings:

```sh
export XDG_DATA_HOME=/workspace/.local/share
CI=true pnpm install --frozen-lockfile
```

Use the same `XDG_DATA_HOME` for subsequent cloud commands. This path applies to the cloud workspace. Teammates can use the normal installation command.

## Costs and service limits

Voice, input transcription, API requests, storage, and jobs can have different prices. Tool services can add their own charges or limits.

Use dated [OpenAI prices](https://openai.com/api/pricing/) before a paid test. Include input, cached input, output, transcription, and external charges in the estimate.

The unattended test budget is USD 10. A conservative upper bound is necessary before paid tests. Without that bound, do not start the test.

This is an admission budget, not a provider invoice cap. A session timer does not prove the total cost. Record unknown charges as unknown.

## Troubleshooting

| Problem                      | Action                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Local session expired        | Reload Sona. Drafts remain in local storage.                                                       |
| Port in use                  | Stop the other local process or select a different `SONA_PORT`. Update the OAuth callback too.     |
| Microphone denied            | Permit microphone access for the local Sona origin in Chrome. Select **Devices** again.            |
| No sound                     | Examine Chrome's playback permission and the operating system's selected output.                   |
| Device change failed         | Keep the microphone off. Select an available device, then try again.                               |
| OpenAI authentication failed | Open **Settings** and replace the project key after active operations end. Examine project access. |
| Calendar access expired      | Use the connection's sign-in control. Keep the intended agent draft.                               |
| Write outcome unknown        | Reconcile the action with the service. Do not repeat the write blindly.                            |
| API operation unavailable    | Read its implementation, lifecycle, credential, and live-verification states separately.           |
| Model settings disagree      | Examine requested and returned values. Do not treat **Saved** or **Sent** as **Applied**.          |

Before a participant study, read [the live verification procedure](../verification/live-checks.md). An unverified device or service remains a release limitation.

## Portable runtime

Export an agent with **Export agent**. Put the file outside the source checkout.

```sh
pnpm example:agent --config /private/path/sona-agent.json --connections /private/path/bindings.json
```

The optional bindings file contains an array of local connection definitions. Use environment-variable names for credentials. Sign in independently at the runtime's local page.

The runtime opens local port 4320. It uses the same validator, OpenAI translation, voice coordinator, connection adapter, and action executor as Sona. Its database contains only the action journal. It does not open the study database.

For portable resources, give a tool a logical `resource` such as `test-calendar`. In the private connection definition, set `resourceBindings` to the actual permitted identifier. Set the matching tool policy's `resourcePointer` and `resources`. Sona resolves the binding before the proposal and approval. It does not add undocumented tool fields.

Keep actual account bindings and credential values out of exported configurations. A tool schema change needs a new review.

An optional `idempotencyPointer` must refer to a field in the discovered schema. Set `idempotencyEncoding` to `operation-id` or `sha256`.
Sona prepares this value before the spoken proposal. It does not add a hidden provider parameter during dispatch.
Configure a read-only reconciliation tool for unknown outcomes. New writes to the same account and resource remain blocked until the outcome is resolved.

For spoken writes, enable input transcription and turn detection. Select transcription language `ko` for Korean confirmation; other values use English confirmation.
Response language instructions are separate prompt guidance. Automatic transcription language does not select the confirmation protocol.

## CSV evidence

Study CSV export gives a `tar.gz` file. Extract it to get configurations, sessions, events, actions, outcomes, metrics, and participant CSV files. The JSON manifest gives joins, units, scope, and measurement definitions. Spreadsheet formula inputs are escaped.

## API transport console

The API library gives JSON and form views, request validation, file upload, binary download, streaming results, pagination, and job polling. Use **Stream console** for a separate bidirectional API session. Confirm the request before billable or destructive operations.

The browser's measured voice connection has audio only. Its server-side control connection handles settings and tools. The API library cannot attach to a measured Sona call.

A webhook needs `OPENAI_WEBHOOK_SECRET` on the server and a reachable HTTPS callback. The local handler checks signed bytes and duplicate identifiers. Sona does not publish a callback endpoint.

Use **Inspect deliveries** for verified webhook records. They stay in memory. Pagination and job polling have local stop controls.
Stopping local observation does not cancel a remote job. Use the documented remote cancel operation separately.

The default voice session ends after 15 minutes. API request files and stored results have size limits. These limits do not guarantee an invoice cap.

## Maintenance

Stop Sona and make a private backup before an upgrade. Keep the pinned runtime and lockfile with each release.
Run `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` after code changes.
Run `pnpm coverage:api` after a schema update. Compare the source hash and operation inventory before release.

The API library preserves source defaults, constraints, and deprecation flags. Account access and lifecycle availability are separate checks.
Do not infer current service availability from a successful schema compilation.

## Organize your workspace

Hover or focus an agent, study, or session in the left sidebar and open its three-dot action menu. Touch devices show the action button directly. Choose **Rename**, **Pin to top** / **Unpin**, or **Delete**. Names and pins remain after a reload or server restart. **Show all sessions** reveals older records.

Session names organize the sidebar without changing the recorded configuration or study protocol. Agent and study renames update their current names; earlier snapshots remain fixed.

Deletion requires a confirmation. Deleting a study also removes its local runs, assignments, consent records, and evidence. An agent referenced by sessions or study conditions is protected until those references are removed. Exports and actions already performed in external services are separate.

The session **Delete** action is grouped below the evidence area, separate from live voice controls. The same action is available from the session's sidebar menu.

Use the icon beside **Agent controls** to collapse the inspector. Select the collapsed rail to reopen it. Drag its left border to resize it on desktop; a focused border also responds to Left/Right arrows, Home, and End. Double-click the border to restore the default width. Width and collapse preferences are saved in this browser. On phones, controls open in a drawer with a dimmed backdrop; close it with its header icon, Escape, or the backdrop.

## Audio device recovery

When the built-in microphone and speakers are the system defaults, their named entries use the same system device path. Choosing those entries during a call does not reopen the microphone or unnecessarily switch the speaker engine.

**Check microphone permission** reuses a live session input. If that input has ended, it attempts to replace it within the current voice connection. An idle check opens and releases a temporary input. A failed replacement preserves the working input and its mute preference. A speaker switch that stalls falls back to system output after three seconds.

A browser microphone permission prompt can remain pending even after Sona's 15-second wait expires. Respond to the prompt or reload Sona before retrying. Sona prevents overlapping requests and releases any stream that arrives after cancellation. Keep the Mac unlocked and awake for physical microphone/browser testing; a locked computer prevents Computer Use from inspecting browser prompts. A timeout alone does not establish a faulty microphone or a need to restart the system audio service.
