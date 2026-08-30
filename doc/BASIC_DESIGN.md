# Basic design: a summarizer for the page in front of the reader

## 1. Purpose

This document states how the requirements in
[`REQUIREMENTS.md`](REQUIREMENTS.md) are met: what the extension is composed of,
what each part is responsible for, how one summary proceeds from the reader's
action to the text on the screen, and what is held between runs.

It does not restate why anything is required. Where the requirements settle a
question, this document takes the answer as given and designs to it; where they
deliberately leave a question open — how a page is extracted, how the parts are
divided, what the endpoint is called with — this document settles it.

**The requirements are the authority.** Where this document and
`REQUIREMENTS.md` disagree, `REQUIREMENTS.md` is right and this document is the
one to correct.

It does not go down to the source. A module is named by what it is responsible
for, not by the functions it will contain, and no code appears here.

## 2. Design policy

Seven decisions shape everything below.

- **Nothing runs until the reader asks.** There is no content script declared in
  the manifest and no listener on navigation. The extraction pass is injected
  into a tab at the moment a summary is requested, and the extension has no
  standing presence in any page. This is the design of requirement §9, not a
  rule laid over it.
- **One action is the whole interface.** Clicking the toolbar action is the
  request to summarize. Everything else the reader can do — reading the result,
  running it again, setting a token — follows from that click.
- **The service worker owns a run.** Extraction, shaping, prompt assembly, the
  request and the state all meet in one place. The panel renders; it decides
  nothing.
- **Four concerns, four modules, one direction of dependency.** Extraction,
  shaping, the prompt and the engine client are separate, and each knows only
  the shape of what it is handed. Changing the model touches the engine client
  and the settings; improving the prompt touches a file that no module reads
  the contents of.
- **The prompt is data, not code.** It is a packaged resource read at run time,
  so improving how a summary is written is editing a text file.
- **The token is the reader's, and only ever in two places.** The profile's
  extension storage, and the `Authorization` header of a request to the AI
  Engine. It is never in the page, never in the panel document, never in a log.
- **The page's text is material, never instruction.** It is quoted into the
  prompt as the thing being summarized, and it is put on screen as text rather
  than as markup.

## 3. Composition

The extension separates into parts that each own one concern:

```text
                        the reader clicks the action
                                    │
                                    v
   ┌─────────────────────────────────────────────────────────────┐
   │ service worker                                              │
   │   orchestrates one run and holds its state                  │
   └──┬──────────────┬───────────────┬────────────┬──────────────┘
      │ inject once  │ read settings │ build      │ request(s)
      v              v               │ prompt     v
   extraction     chrome.storage     v         engine client
   in the tab       .local        prompt          │
      │                           resource        │ HTTPS
      │ blocks                       │            v
      v                              │      Sakura AI Engine
   shaping ─────── material ─────────┘            │
                                                  │ summary text
                                                  v
                                    state and result, per tab
                                                  │
                                                  v
                                            side panel
```

The reader's browser is the only place any of this runs. **There is no server
belonging to this project in the picture, and no arrow leaves it except the one
to the AI Engine.**

## 4. Repository layout

```text
.
├── manifest.json               MV3: permissions, the action, the panel, options
├── src/
│   ├── background/             the service worker: one run, start to finish
│   ├── extract/                injected into the tab, once, per request
│   ├── shape/                  blocks in, prompt material out
│   ├── engine/                 the only module that speaks to the AI Engine
│   ├── panel/                  the side panel document: state and result
│   ├── options/                the settings document: token and model
│   └── common/                 the settings accessor, the error kinds
├── prompts/
│   └── summarize.md            the summarization instruction, as data
├── README.md
└── doc/
    ├── REQUIREMENTS.md
    └── BASIC_DESIGN.md
```

Three absences are deliberate. **There is no build step**, so the directory that
is loaded in developer mode is the directory that is committed — which is what
makes "load unpacked from a clone" the whole of the installation. **There is no
bundled third-party library**, for the reason in §8.4. **There is no
`content_scripts` entry**, for the reason in §2.

## 5. The extension shape

Manifest V3, in Google Chrome, loaded unpacked. Four contexts exist and no
other.

### 5.1 The service worker

The background context, event driven, holding no state that matters across a
browser restart. It is where a run happens:

- it receives the action click,
- it reads the settings,
- it injects the extraction pass into the target tab and receives its result,
- it hands the blocks to shaping,
- it assembles the prompt,
- it calls the engine client,
- it records the state of the run, and its result or its error,
- it tells the panel that the state changed.

**Every decision in a run is taken here**, so that there is one place to read
when the question is what happened.

A service worker can be terminated between events. The state of the last run is
therefore kept where a restart does not lose it — see §14 — rather than in a
variable the worker happens to still have.

### 5.2 The injected extraction pass

Not a declared content script. It is injected with `chrome.scripting` into the
tab the reader acted on, at the moment they acted, and it runs once.

Its whole responsibility is to read the document and return an ordered list of
blocks (§8). It performs no network access, holds no token, reads no setting,
and leaves nothing behind in the page: **the page is read, never written**.

### 5.3 The side panel

The surface the reader looks at. It renders one of four states (§14) and, on
success, the summary. It shows state and results, and offers a way to the
options page. It does not start a run.

It performs no extraction and makes no request to the AI Engine. It receives
what to display and displays it.

### 5.4 The options page

The token, the model, and the Japanese summary preference, and nothing else
(§13). It is opened from the panel and from Chrome's extension list, and it is
the only place a token is entered.

## 6. Permissions

Least privilege, and each entry earns its place:

| Permission | Why it is needed |
|---|---|
| `activeTab` | the right to read the tab the reader acted on, granted by that click and lasting no longer |
| `scripting` | to inject the extraction pass once, on request |
| `storage` | the token, the model and the Japanese summary preference in the profile; the state of the last run for the session |
| `sidePanel` | to show the result beside the page it came from |

| Host permission | Why it is needed |
|---|---|
| the Sakura AI Engine API origin | the one origin the extension may send anything to |

**What is deliberately absent matters as much as what is present.**

- **No host permission for any site.** The extension is not granted access to
  the sites the reader visits. `activeTab` gives it the tab it was invoked on,
  at the moment of invocation, and that is the whole of its reach into the web.
- **No `content_scripts` declaration**, so nothing of this extension is loaded
  into a page that was not summarized.
- **No `tabs`, `history`, `webNavigation`, `bookmarks` or `alarms`.** Each of
  them would be the machinery for watching a reader rather than answering one,
  and none is needed to summarize the page in front of them.

The host permission names the AI Engine origin and nothing else, so **a request
to anywhere else is refused by Chrome rather than by this design being obeyed.**

## 7. The user interface

### 7.1 Why the side panel

The requirement is that the result is read without leaving the page it came from
(§13), and that ordinary use is one operation (§9). Three surfaces could carry a
result, and the side panel is chosen:

| Surface | Why not |
|---|---|
| the action popup | it closes as soon as the reader clicks anything — including the page they are reading. Comparing the summary against the page, which is the thing a reader does next, would dismiss the summary every time |
| an overlay injected into the page | it modifies the page being read, inherits and fights the site's CSS, and needs a standing presence in pages that the permission model is built to avoid |
| a tab or a window | it takes the reader off the page, which is what §13 asks it not to do |

The side panel has the properties the requirement asks for: **the page stays
visible, scrollable and untouched while the summary sits beside it**, the panel
survives clicks into the page, and it is an extension document with its own
styling and its own CSP, so nothing in the page can reach it and nothing of it
can disturb the page.

### 7.2 The one operation

```text
  click the toolbar action
          │
          ├── the side panel opens for this tab
          └── the run starts for this tab
```

The click is the reader's explicit request, and it is the only way a run begins.
Opening the panel by other means shows the state of that tab — for a page never
summarized, that state is "not run yet" and waits for the toolbar action.

Navigating to another page **never starts a run**. The panel returns to "not run
yet" for the new page, and waits to be asked.

### 7.3 What the panel shows

| State | What the reader sees |
|---|---|
| not run yet | the page's title, and the control that runs a summary |
| in progress | that a summary is being produced, and that it may take some time |
| succeeded | the summary, and the control to run it again |
| failed | what went wrong, in the terms of §17, and the control to try again |

The summary is rendered as text. **No markup from the page and no markup from
the model is put into the panel's DOM** (§18), and no summary is written to
disk.

### 7.4 The options page

Two fields, a save, and a statement of what the token is used for and where it
is kept. Nothing is validated by contacting the AI Engine: a token that does not
work is discovered by the first run that uses it, and reported as §17 requires.

## 8. Extraction

### 8.1 What is collected

An ordered list of blocks, each carrying a kind and its text:

| Kind | Taken from |
|---|---|
| title | the document title, or the page's own main heading where that is more faithful |
| heading | `h1`–`h6`, with the level kept |
| paragraph | ordinary prose blocks |
| list item | items of ordered and unordered lists |
| table cell | the significant text of table rows |
| quote | block quotations |
| code | preformatted and code blocks, kept because a technical page is often unreadable without them |

Order is the reading order of the document, because the argument of a page is
carried by its sequence as much as by its sentences.

### 8.2 What is dropped

As far as it can be recognized, and never by naming a site:

- structural furniture — navigation, banners, menus, footers, complementary
  regions, and the elements HTML already labels as such,
- anything not being displayed — hidden elements, elements marked hidden from
  assistive technology, collapsed regions,
- scripts, styles, embedded frames and form controls,
- link-dense blocks that are lists of links rather than prose, which is what
  most advertising and most site-common furniture looks like from inside the
  document.

### 8.3 The fallback ladder

One generic strategy, tried in order, stopping at the first that yields enough
text:

```text
  1. the document's declared main content region
  2. the largest article-like region, scored by how much prose it holds
     against how much of it is links and furniture
  3. the body, with §8.2 applied
```

**Each rung is more permissive and less accurate than the one above it.** A page
that reaches the third rung produces a noisier summary; a page that yields too
little text even there ends as the "not enough text" case of §17.

### 8.4 No extraction library, and what changes if one is adopted

**The initial version adopts no third-party extraction library.** The reasons:

- the requirements explicitly do not promise complete extraction (§8 of the
  requirements), so the accuracy a library buys is not what the initial version
  is being judged on,
- vendoring one means shipping third-party code that runs inside every page a
  reader summarizes, which is the most sensitive position in this design,
- it would introduce either a build step or a vendored bundle, and §4 spends
  that budget on "the clone is the extension".

The decision is confined, not final. **Extraction is a module behind one
interface — a document goes in, blocks come out** — so adopting a library later
is a change to `src/extract/` alone. If one is adopted, three things must be
recorded with it: why it was chosen, that it runs only inside the injected
extraction pass, and that its failure falls back to the ladder in §8.3 rather
than failing the run.

### 8.5 What is not promised

Requirement §8 is carried into the design as it stands: a page whose content is
generated after load, held in a shadow tree, behind an authentication state, or
built in a way this generic strategy does not recognize **may yield too little
text, and that is an ordinary outcome.** It is reported to the reader as itself
(§17), never as a fault of the network or the endpoint, and never papered over
by summarizing whatever furniture happened to be extractable.

## 9. Shaping

Blocks are not sent as they were found. Between extraction and the prompt sits
one shaping pass, whose entire output is the *material*: a title and a body of
blocks, in order.

### 9.1 What shaping does

- **Normalizes whitespace.** Runs of spaces, tabs and blank lines collapse; the
  block boundaries survive.
- **Drops what carries nothing** — empty blocks, and blocks that are a single
  stray character or punctuation mark.
- **Removes repetition that is an artifact of the page**, not of the argument:
  a block repeated identically elsewhere in the document, which is how headers,
  captions and site furniture usually survive extraction.
- **Keeps the heading hierarchy**, marked by level, because the structure of a
  document is evidence about what its author considered subordinate — and
  subordination is exactly what semantic compression must be able to see.
- **Keeps the title separate from the body**, so the prompt can say which is
  which rather than leaving the model to infer it from position.

**Shaping does not rewrite, translate, reorder or summarize.** Every judgement
about what matters belongs to the model; shaping only removes what is not
content.

### 9.2 Too little content

Below a minimum amount of body text, the material is not worth a request. The
run stops before anything is sent and reports the "not enough text" case of §17.

**The threshold is a design constant, not a setting** (§13), because a reader
has no way to choose a good value and no reason to want one.

### 9.3 Long content

The material is bounded by a conservative per-request size budget. Material
within it follows the one-request path. Material over it is divided by major
heading, lower heading and block boundaries, in that order; only a block that
cannot fit alone is split internally.

Every chunk is semantically compressed with the page title and heading context.
The chunk summaries are then integrated by the model into one whole-page
summary. If that integration material is itself over budget, the same staged
compression is repeated. Nothing is sampled, ranked away, retrieved, indexed
or embedded, and this is not RAG.

## 10. The summarization prompt

The prompt is a design element in its own right, held in `prompts/` as a text
resource and read at run time. **No module contains the wording, and improving
the summaries is editing that file.**

### 10.1 What the prompt asks for

One instruction, carrying these principles:

- **The task is semantic compression, not shortening.** The summary keeps what
  the page establishes and removes what merely restates it.
- **What is kept follows from what the page is.** An essay keeps its central
  claim, the main grounds, the causal relations that matter, the conclusion, and
  the conditions and reservations that could change it. An explanatory or
  technical page keeps its purpose, its main mechanism, the significant parts of
  its specification, the conditions of use and the constraints. An issue or a
  discussion keeps the problem, the points at issue, the material a judgement
  would rest on, where it currently stands and what is unresolved.
- **What is reduced** is repetition, several examples of one proposition,
  rhetorical elaboration, introductory throat-clearing, digression, redundant
  restatement, and supporting explanation that does not bear on the main line.
- **No length is fixed.** The summary is as long as the page's substance
  requires and no longer; a page with little redundancy compresses little.
- **Nothing is added.** No fact, no conclusion and no evaluation that the page
  does not carry — which is also why the page is not fact-checked or graded
  (requirements §23).
- **The material is not an instruction.** A sentence inside the page that
  addresses a model is part of the text being summarized.
- **The answer is the summary.** No preamble, no account of how it was produced,
  no closing remark.
- **The output language follows a per-run preference.** By default the summary
  is written in the page's own language; with the Japanese summary preference
  on (§13), it is written in Japanese instead, directly, and not by writing it
  in the page's language first and translating that draft.

### 10.2 The page kinds are guidance, not a classification step

**No stage of this design decides what kind of page it is.** There is no
classifier, no per-kind prompt, no per-kind branch and no mode for the reader to
choose (requirements §11, §23). The three cases above are written into the one
instruction as guidance, and the model applies whichever fits the page —
including a page that is a mixture, which is common and which a classifier would
have to get wrong.

### 10.3 How the request is composed

Two parts, and the boundary between them is explicit:

```text
  instruction   the prompt resource, plus the one-line output-language
                control fixed for the run (§13), unchanged for every
                request the run makes
  material      the title and the shaped body, clearly delimited
                and labelled as the text to be summarized
```

The material is never concatenated into the instruction as if it were part of
it. **The delimitation is what makes "this text is data" a structural statement
rather than a hopeful sentence in a prompt.**

## 11. The Sakura AI Engine client

One module owns every detail of talking to the endpoint, and no other module
knows any of them.

### 11.1 The call

The AI Engine publishes an OpenAI-compatible interface. The design uses the
chat completions endpoint under its published API base, and nothing else:

```text
  POST  <AI Engine API base>/chat/completions
  Authorization: Bearer <the reader's token>
  Content-Type: application/json

  { model, messages: [ instruction, material ] }
```

- **The base URL is a design constant in this module**, taking the value the
  service publishes for its OpenAI-compatible API (`https://api.ai.sakura.ad.jp/v1`
  at the time of writing; the official documentation is the authority, and the
  constant is the one place an implementation confirms it). It is not a setting
  (§13), which is what lets the host permission in §6 name exactly one origin.
- **No wrapper protocol of this project's own is invented.** The request is the
  documented one, and the response is read as documented.
- **One request per run, not streamed.** The reader is told the run is in
  progress (§14) and the answer arrives whole. Streaming would buy a progress
  effect at the cost of partial-answer handling that nothing here requires.

### 11.2 The answer

The generated text of the first returned choice is the summary. Anything else
in the answer is ignored rather than interpreted.

An answer that is missing, empty, or not the documented shape is **not** shown
as a summary: it becomes the "no usable summary" case of §17. A blank panel and
a fragment of protocol are both worse than being told the run failed.

### 11.3 Timeout and retries

One bounded wait, enforced by the client and applied to the whole request. On
expiry the run fails with the timeout case of §17.

**A failed run is not retried automatically.** One click by the reader is one
request to the AI Engine. Retrying is the reader clicking again, which keeps
what their token is spent on visible to them and keeps a failing endpoint from
being called repeatedly on their behalf.

### 11.4 The model

The model name travels from the settings into this module and appears in the
request. **Nothing else in the design refers to a model**, no prompt is tuned to
one, and no behaviour branches on which one is configured, so changing it is
changing a setting (requirements §14).

The service publishes its own list of available models; the reader learns valid
names from there. The extension does not fetch that list — it would be a second
call, a second error path and a second failure mode, for a field a reader sets
once.

## 12. The API token

BYOK, as requirement §15 requires. The design has one place a token lives and
one place it goes.

### 12.1 Where it is kept

**`chrome.storage.local`**, in the reader's own browser profile.

| Considered | Decision |
|---|---|
| `chrome.storage.local` | **chosen.** It stays on the machine it was entered on |
| `chrome.storage.sync` | rejected. It would replicate a credential through the reader's Google account to every browser they are signed into, which is a decision this project should not make on their behalf — and its per-item quotas are designed for preferences |
| `chrome.storage.session` | rejected for the token. It is cleared with the browser, and a reader would re-enter their token every day |

### 12.2 How it travels

The token is read by the service worker, used to build one `Authorization`
header, and dropped. It is **never** passed to the injected extraction pass,
never sent into the panel or the page, never written into a URL, never logged,
and never included in a message shown to the reader.

The options page is the only document that shows the field at all, and it is an
extension document — no web page can read it.

### 12.3 What this does not promise

**A token held by a browser extension is not a secret kept from the person at
the keyboard.** Whoever controls the profile can read extension storage, and no
arrangement inside an unpacked extension changes that.

What §15 of the requirements actually demands is achievable and is what this
design delivers: the token is not in the source, not in the repository, not in
anything distributed, and never sent to a server belonging to this project —
because there is none. Encrypting storage with a key that must itself live in
the same profile would add ceremony without adding a guarantee, and is not part
of this design.

## 13. Settings

| Setting | Held in | Notes |
|---|---|---|
| the Sakura AI Engine API token | `storage.local` | entered by the reader; no default |
| the model | `storage.local` | a documented default, so a reader who sets only a token can run |
| the Japanese summary preference | `storage.local` | a boolean, off by default; saved independently of the token and the model |

**That is the whole of the settings.** The endpoint, the timeout, the size
budget, the minimum length and the prompt are design constants and resources,
not knobs: none of them is something a reader has the information to choose, and
each one exposed would be a second decision on a path that requirement §9 asks
to keep to one.

## 14. State

Four states, exactly those of requirement §17 plus the state before anything has
happened:

```text
  not run yet ──> in progress ──┬──> succeeded ──┐
                                └──> failed ─────┤
                                                 │
        (the reader asks again) <────────────────┘
```

State belongs to a tab, so that summarizing one page does not disturb what
another tab is showing.

- **The service worker sets it**; the panel reads it and renders it.
- **It is kept in `chrome.storage.session`**, which is held in memory and
  cleared when the browser closes. This survives the service worker being
  terminated mid-life, which Manifest V3 permits at any time, so the panel can
  be reopened and still show the last result.
- **No summary and no page text is written to disk by this design**, which is
  what §16 requires of it.

No state management framework, no store, no persisted history. The panel asks
for the current state when it opens and is told when it changes.

## 15. The flow of one summary

```text
  reader                action        service worker      tab        AI Engine
    │                     │                 │              │             │
    │ clicks ────────────>│                 │              │             │
    │                     │ ── run ────────>│              │             │
    │      panel opens <──┘                 │              │             │
    │                                       │ state: in progress         │
    │                                       │              │             │
    │                                       │ inject ─────>│             │
    │                                       │<── blocks ───┤             │
    │                                       │              │             │
    │                                       │ shape                      │
    │                                       │ build prompt               │
    │                                       │ read token + model         │
    │                                       │                            │
    │                                       │ ── POST /chat/completions ─>
    │                                       │<────────── summary ─────────
    │                                       │                            │
    │                                       │ state: succeeded           │
    │<──────────── the panel renders it ────┘                            │
```

Read as the eight steps of requirement §9 and of this task's brief:

1. the reader is on a page,
2. the reader clicks the action — the only trigger there is,
3. the extraction pass is injected once and returns blocks (§8),
4. shaping produces the material (§9),
5. the prompt is assembled from the resource and the material (§10),
6. the request goes to the AI Engine with the reader's own token (§11, §12),
7. the summary comes back and is validated as usable (§11.2),
8. the panel renders it beside the page (§7).

Any step may end the run instead, and every way it can is in §17.

## 16. Privacy design

The requirements' privacy properties are structural here rather than
promissory:

| Requirement | What makes it true |
|---|---|
| a page is read only when a summary is asked for | no declared content script, no navigation listener; injection happens on the click |
| no page but the target is touched | the run reads one tab, the one `activeTab` was granted for |
| no browsing history is collected | no `history` or `tabs` permission, and nothing records a URL beyond the state of the run |
| no page text reaches a server of this project's | there is no such server; the only outbound origin is the AI Engine, and it is the only host permission |
| no summary is stored in a cloud | the result lives in session state and is gone when the browser closes |
| no token reaches a server of this project's | the token is in one header, to one origin |

**What is sent to the Sakura AI Engine is the shaped text of the page the reader
asked about, together with the instruction.** That is the point of the
extension, it is not incidental, and the README must say so plainly to a reader
deciding whether to install it. This design makes no attempt to obscure it.

## 17. Errors

Every failure ends the run, sets the failed state, and shows the reader one
message that names the cause and what would address it. There is no error
taxonomy beyond this table, and no failure is silent.

| Situation | Detected in | What the reader is told |
|---|---|---|
| no token configured | the service worker, before extraction | that a token is needed, with the way to the options page |
| the token was rejected | the engine client, from the authentication failure | that the token was refused, and to check it |
| the request could not be made | the engine client, from the transport failure | that the AI Engine could not be reached |
| the request timed out | the engine client's bounded wait | that it took too long, and that trying again is reasonable |
| the endpoint returned an error | the engine client, from the answer | that the AI Engine reported an error, and which kind it was |
| the page could not be read | the service worker, from the injection failing | that the content of this page could not be obtained |
| not enough text | shaping (§9.2) | that this page has too little text to summarize |
| no usable summary in the answer | the engine client (§11.2) | that no summary came back, and that trying again is reasonable |

Two rules hold across the table.

- **A message names the cause, not the internals.** No status line, no response
  body, no token, no stack.
- **Distinguishable causes stay distinguishable** (requirements §18): "no token"
  and "token refused" lead to different actions, so they are never merged into
  one message about the API.

## 18. Security design

Five measures, each in one place.

- **Least privilege, structurally.** §6. The extension can reach the tab it was
  invoked on and one API origin. There is no configuration that widens either.
- **The page's text is material.** It is quoted into the prompt as the thing
  being summarized and delimited from the instruction (§10.3). A sentence in a
  page that addresses a model is text being summarized.
- **Nothing from the page or the model becomes markup.** The panel puts text
  into the document as text, never as HTML. The initial version therefore needs
  no sanitizer and renders no Markdown — a decision that removes a class of
  problem instead of defending against it.
- **No remote code, by construction.** Manifest V3's extension CSP forbids
  remote script and `eval`; this design adds nothing that would need either. The
  panel and the options page load only resources packaged with the extension.
  Nothing fetched from the AI Engine is ever executed.
- **The token is handled as in §12**, and the one origin it may be sent to is
  fixed in the manifest, not in a setting.

The measures are sized to what this is: a personal extension, loaded unpacked,
holding one credential that its own reader owns. **No key ceremony, no
integrity mechanism and no policy engine appears here**, because none of them
would defend against anything this design is actually exposed to.

## 19. What is not built

Requirement §23 lists what the initial version excludes, and **none of it is
prepared for here.** In particular this design has no seam kept open for a
backend, no account model waiting to be filled in, no storage schema for a
summary history, no retrieval or embedding stage, no scheduling, no
cross-page state, no standalone translation path, and no second
summarization mode. The Japanese summary preference (§13) is not an
exception to the last two: it adds no translation result separate from the
summary, and no mode besides the one summarization instruction the design
already has — it only fixes which language that one instruction writes in.

Where a decision above could have left room for one of those and chose not to —
the single origin in §6, the refusal rather than truncation in §9.3, the session
state in §14 — that is the reason.

## 20. Mapping to the requirements

| Requirement | Where it is met |
|---|---|
| §7 Chrome, unpacked from a clone | the manifest and the absence of a build step, §4 |
| §8 general pages, extraction not promised | the generic ladder in §8.3 and the statement in §8.5 |
| §9 only on request, and one operation | no content script and injection on the click, §2 and §5.2; the single action, §7.2 |
| §10 what is taken and what is left out | the block kinds in §8.1 and the exclusions in §8.2 |
| §11 what a summary keeps | the prompt's principles in §10.1, applied without a classifier, §10.2 |
| §12 semantic compression, no fixed length | §10.1, and the refusal to truncate in §9.3 |
| §13 read beside the page | the side panel and the reasoning in §7.1 |
| §14 the AI Engine, model interchangeable | the client in §11, the model as a setting in §11.4 and §13 |
| §15 the token | storage and travel in §12, its limits in §12.3 |
| §16 privacy | the structural table in §16; no backend anywhere in §3 |
| §17 the state of a run | the four states and their home in §14 |
| §18 errors, distinguishable | the table in §17 |
| §19 maintainability | four modules with one direction of dependency, §2 and §4; the prompt as a resource, §10 |
| §20 simplicity | one action, §7.2; three settings, §13; no build step, §4 |
| §23 out of scope | §19 |
| §24 acceptance conditions | conditions 1–3 by §4–§7, 4 by §2 and §5.2, 5 by §8, 6–7 by §10 and §11, 8 by §7.3, 9 by §14, 10 by §17, 11–12 by §12 and §16, 13 by the README work that requirement §21.1 records |
