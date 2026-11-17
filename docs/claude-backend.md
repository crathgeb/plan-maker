# Claude as a backend

How **Send to Claude** works: the reader's notes become a job that a Claude Code session picks up, hands to a background subagent, and closes, while the page follows along. It's the pattern from [design-driven-development](https://github.com/crathgeb/design-driven-development) (`docs/claude-as-a-backend.pdf` there), applied to plan-maker's pages.

The review server handles everything with a fixed answer: saving notes, versions, status, serving the page. Writing the next version needs judgement, so it becomes a **job**. The server never calls a model and holds no API key: Claude subscribes to the server, not the other way round.

## The parts

| Part | Started by | Does |
|---|---|---|
| The page | The reader | Saves notes as they're written. **Send to Claude** saves once more and asks the server for a job. Shows whether Claude is connected, locks while Claude has the notes, and reloads into the new version. |
| Review server (`scripts/review.mjs`) | The Claude session working the page (a background task, `--replace`), or the hub | Saves `notes.json`, turns Send into a job, offers it to a listener, refuses note saves while it's active, watches the page file, pushes events to the page. |
| Listener (`scripts/listen.mjs`) | Claude, under the **Monitor** tool | Holds an event stream to its page's review server (or, with `--project`, every server in the project) and prints one line per event. Each line wakes the session. |
| Claude session | The reader | Claims each job (`job.mjs start`), starts a background subagent with its pack, and closes it (`job.mjs done` or `fail`). |
| Worker | Claude (background subagent) | Reads the context pack, does one round (snapshot, revise, check, register) and ends with `SUMMARY:` or `FAILED:`. |

## Each session runs its own server

The session that works a page's notes starts that page's server itself, as a background task, and listens to it under Monitor. Server and listener then live and end with the session that works the notes, so a page that says "Claude connected" is connected to the session that started it.

- `review.mjs <page> --replace` stops any server already serving the page (the hub's, a link's, another session's) and starts on the same port, so tabs already open reconnect by themselves: the old server ends their event streams with `bye`, and they look for the new one within seconds.
- A server from an older build (its `/api/health` has no `backend`) is replaced even without `--replace`. A listener that reaches one prints the command that replaces it, and stops.
- Without `--replace`, a current server for the page is reused, as before. The hub and links start servers that way, so they never take a page from a session.
- To bring up a whole repo, `launch.mjs plans|docs|all` serves every active page as its own children, with `--replace`, and one `listen.mjs --project` connects them all. The servers stop when the launcher stops, even when it's killed outright, because each one watches its parent. The `launch-pages` skill does this when the user says "launch my plans" or "launch my docs".
- When the session ends, its server stops and the page says so. The hub can open it again, with Claude offline, until a session takes it over.

## One round, end to end

1. **Notes.** The reader comments, asks, draws and decides. The page saves to `notes.json` through `PUT /api/notes`. No model is involved.
2. **Send.** `POST /api/send` makes the job: one per page at a time (a second Send while one is waiting returns the same job). The record and its Markdown context pack go in `~/.plan-maker/jobs/<page hash>/`, outside the repo. The page locks.
3. **Wake.** The server offers the job to the newest listener over `GET /api/claude/events`. The listener prints a line with the exact commands to run, and the line wakes Claude.
4. **Start.** `job.mjs <page> start <id>`. The page shows "Claude is writing v<N+1>". Claude starts a background subagent with `Read <pack> and do the job it describes.`
5. **Work.** The worker follows `process-notes`, steps 1 to 8: snapshot (`versions/v<N>.html` and its notes), write v<N+1> into the live file, write any guides asked for, `check.mjs`, update the registry.
6. **Close.** `job.mjs <page> done <id> --summary "…"`. The page reloads into v<N+1> and shows the summary. On `fail`, it unlocks and shows why.

If no listener is connected, the job waits on disk and the page says so: "Your notes are saved and waiting for Claude". The next listener to connect is offered it. The reader can also **Take them back** before Claude starts, and saying "process my notes" in a session claims a waiting job and does the round there.

## Run it: Claude's own steps

A Claude step or phase that isn't done has a **Run it** button: the reader telling Claude it's time to do its part. It's the same loop as a round, with a different job:

- **`POST /api/run { step }`** makes a `run` job for that step (a second press while it waits returns the same job). It's refused for a step that isn't Claude's (400), one already done (409), or while the page has another job (409).
- **The listener line** tells the session to claim it, read its pack and do the step **in the session itself**, not a subagent. It's real work in the project, and the user may need to answer questions.
- **The pack** says: read the step and what it depends on; set its `data-status="doing"`; do the work; set it to `"done"`; log it with `registry.mjs update --log`; end with `SUMMARY:` or `FAILED:`. There's no snapshot and no new version.
- **The page isn't locked:** notes still save. Send and the other Run it buttons wait, since a page has one job at a time. The button reads **Waiting for Claude · Cancel** while the job waits (pressing it cancels), then **Claude is on it…**. On done the page reloads with the summary; on fail it says why.

## What keeps it reliable

- **The context pack is the whole interface** between Claude and a worker: absolute paths, what the notes ask for, the skill to follow and what's different for a worker, and the required last line. A worker needs nothing else.
- **The page is locked while Claude has the notes.** `PUT /api/notes` answers 409 while the page has an active round (queued, offered or running; a run doesn't lock), so the notes the worker reads can't change under it, and nothing lands on the wrong version.
- **State lives in files.** Notes, versions and jobs can be read, diffed and snapshotted by anyone; every round leaves `versions/v<N>.html` and its notes behind.
- **Jobs persist on disk.** An offer a session never started goes back to the queue when its listener drops, for the next one.
- **Only this machine reports on a job.** `/api/claude/events` and a job's start, done and fail accept only requests from this machine, addressed by name; a page on another device (network mode) can send and take back its notes, nothing more.

## Limits

- A round takes a minute or a few, and costs model usage. The page treats it as asynchronous.
- A Monitor watch ends after 30 minutes; Claude re-arms it while the reader is still reviewing. Jobs wait on disk in between.
- The listener is a background process of the session and stops when it ends. Pages still save and Send still queues; the next session picks the notes up.
- One reader per page, on their own machine (or their own devices in network mode).

## API

| Method and path | From | Does |
|---|---|---|
| `POST /api/send` `{ message? }` | the page | A job for the page's notes, or the active one. 400 when there's nothing to send. |
| `POST /api/run` `{ step, message? }` | the page | Run it: a `run` job for one of Claude's steps or phases, or the one already waiting for it. 404 for no such step, 400 if it isn't Claude's, 409 if it's done or the page has another job. |
| `GET /api/jobs` | anyone | `{ jobs` (newest first, up to 10)`, active, claude }` |
| `GET /api/jobs/<id>` | anyone | The job, with its pack's path |
| `POST /api/jobs/<id>/start` · `done { summary }` · `fail { error }` | this machine | The job's progress (job.mjs) |
| `POST /api/jobs/<id>/cancel` | the page | Take the notes back, before Claude starts (409 once it has) |
| `GET /api/claude/events` | this machine | SSE for the listener: `hello`, then `job` with the line to print, `bye` when the server stops |
| `POST /api/claude/state` `{ phase, message }` | this machine | `idle`, `working`, `ready` or `error`, shown on the page (job.mjs sets these itself) |
| `GET /api/stream` | the page | SSE: `hello`, `claude` (connected, phase), `job` (the page's latest), `page` (the file changed on disk), `bye` |

A job record: `{ id, kind: "round" | "run", step? { id, title, unit } (a run), page, pageKind, name, version, next, status: queued|offered|running|done|failed|cancelled, message, asks: { comments, questions, details, guides, marks, decisions, general, total }, createdAt, offeredAt, startedAt, doneAt, summary, error }`.

## Scripts

```bash
node scripts/launch.mjs [plans|docs|all] [--dry-run]       # serve the repo's active pages from this process
node scripts/listen.mjs [--project DIR]                  # every page in the project (default: the git root here)
node scripts/listen.mjs <page>                           # one page; exits ~30 s after its server stops
node scripts/listen.mjs <page> --state working --message "…"
node scripts/job.mjs <page> start|done|fail <id> [--summary S] [--error E]
node scripts/job.mjs <page> list | pack <id>
```

Settings for tests: `PLAN_MAKER_CLAUDE_GRACE_MS` (how long a page still says "connected" after its listener drops, default 60 s), `PLAN_MAKER_LISTEN_RETRY_MS`, `PLAN_MAKER_LISTEN_SCAN_MS`.
