# Implementation Policies

web-digest is one Chrome extension, written in JavaScript and running in the
contexts Manifest V3 provides, so this policy is stated directly for that rather
than separating a shared section from per-language ones.

This document stands on its own. It is the whole implementation policy of this
repository, and no rule here is completed by a document kept somewhere else. A
subject it does not cover is a gap in this document, to be filled here rather
than looked up elsewhere.

The Invariants below decide over the rest of it. Some of what they forbid is
what a general policy would otherwise ask for: this extension does not retry a
failed request, does not discard part of a page in order to return
something, does not keep what it was given so that a fault can be reproduced
later, and does not grow a backend of its own. Those are deliberate, and are not
to be relaxed to match a more general rule.

---

## 1. General Policy

### 1.1 Purpose and Scope
- This document decides how the repository is implemented: the coding rules, the
  responsibilities of the parts and the direction of dependency between them,
  the handling of settings and the credential, the security and privacy rules,
  what a summary is required to be, the approach to tests and documents, and the
  criteria by which a change is judged.
- It applies to everything committed here: the manifest, the service worker, the
  injected extraction pass, the shaping and engine modules, the panel and
  options documents, the prompt, the tests and the documents.
- What the extension is for, what it accepts, what it produces and where its
  responsibility ends belong to the requirements. Its composition, its contexts,
  its permissions, its states, its error table and the shape of a request belong
  to the designs. This document does not restate them; it decides how they are
  carried out.

### 1.2 Relation to the Requirements and the Designs
- [`REQUIREMENTS.md`](REQUIREMENTS.md), [`BASIC_DESIGN.md`](BASIC_DESIGN.md) and
  [`DETAILED_DESIGN.md`](DETAILED_DESIGN.md) are the higher specification of
  this repository. This document is subordinate to all three, in that order.
- Where this policy contradicts one of them, this policy is what is corrected. A
  requirement or a design decision is never bent to suit a rule written here.
- Behaviour those documents do not allow is introduced by changing them first.
  The implementation follows them; it does not lead them.
- Where this document is silent, the design policy of the basic design and the
  order of priorities in the requirements decide.

### 1.3 Design Philosophy
- Prefer the simple implementation. Clarity and long-term maintainability come
  before convenience and before cleverness.
- Make control flow, failures and side effects explicit. Avoid implicit
  behaviour.
- Do not abstract what has one implementation and no named second one.
- Do not add a feature whose necessity has not been demonstrated, and do not
  design in advance for a requirement nobody has written down.
- Keep the four concerns of requirement §19 apart: obtaining the content of the
  page, communicating with the AI Engine, the summarization prompt, and
  displaying the result.
- Keep the quality of a summary in the prompt. How a summary reads is adjusted
  by editing `prompts/summarize.md` wherever that is possible, and not by adding
  a branch to JavaScript.
- The measure of this extension is that one path works: open a page, click the
  action, read the summary beside it. A change that lengthens that path has to
  earn its place before anything else about it is discussed.

### 1.4 Invariants
These lines are not crossed by a setting or by an extension.

- Do not read a page the reader has not asked for a summary of. No declared
  content script, no listener that starts a run, no schedule, no background
  collection.
- Do not read or record the URL of a page, and do not accumulate anything from
  which a browsing history could be reconstructed.
- Do not add a backend belonging to this project, and do not send anything to
  any host but the Sakura AI Engine origin the manifest names.
- Do not supply an API token, ship one, or arrange for a page to be summarized
  without a token the reader configured.
- Do not let the API token leave the service worker except as the value of one
  `Authorization` header: not into the page, not into the injected pass, not
  into the panel, not into a URL, not into the log, not into a message the
  reader is shown.
- Do not write page text or a summary to disk, and do not keep either beyond the
  session state the panel reads.
- Do not treat a sentence found inside a page as an instruction to the extension
  or to the model.
- Do not put text from the page, from the model or from a setting into a
  document as markup.
- Do not load or evaluate code that is not packaged with the extension.
- Do not truncate, sample or rank material to fit a request. Split long pages
  at structural boundaries, semantically compress every part, and integrate
  all parts into one whole-page summary.
- Do not retry a failed run automatically. One action click is one run; the
  requests of a staged long-page run are not retries.

### 1.5 Deciding During Implementation
Where there are several ways to do something, the requirements fix the order in
which they are weighed, and this policy applies it:

1. Read no page the reader did not ask about, and keep nothing that need not be
   kept.
2. Keep the summary faithful to the page: semantic compression, not shortening.
3. Keep the reader's token to one header and one origin.
4. Keep the reader's path at one click.
5. Tell the reader what happened, in terms they can act on.
6. Do not mix the responsibilities of extraction, shaping, the prompt, the
   engine client and the display.
7. Do not put into JavaScript what belongs to the prompt.
8. Introduce no state and no persistence that is not needed.
9. Add no dependency, and no feature, that is not needed.

A decision that cannot be settled by reading this list is settled by the
requirements, and recorded here once it has been.

### 1.6 The Scope of a Change
- One change serves one purpose. A change to extraction, a change to the prompt
  and a change to the panel are three changes, even when one was noticed while
  another was being made.
- Tidying, renaming and reformatting that the change does not require are a
  change of their own.
- A change states which of the four concerns it touches, and touches no other.
  Where it appears to belong to two, the boundary is wrong and is corrected,
  rather than the code being written across it.
- Work that cannot stand without the change is not a second purpose: its
  `doc/VERSIONS` entry, the test that fails without it, and the README or design
  line a change of behaviour requires belong to the change that requires them.

### 1.7 Privacy
- The content of a page is processed only for the run the reader asked for, at
  the moment they asked. Nothing of this extension is loaded into a page that
  was not summarized.
- No browsing history is collected. The page's URL is not read, not returned by
  extraction, not stored and not sent.
- No page text is stored on a server belonging to this project, because there is
  none, and none is written to disk. The result of the last run lives in session
  state, per tab, and is gone when the browser closes, the tab closes or the tab
  navigates elsewhere.
- No summary is stored on a server belonging to this project, for the same
  reason, and no history of summaries is kept anywhere.
- **The content to be summarized is sent to the Sakura AI Engine**, together
  with the instruction, because that is where the summary is produced. This is
  the point of the extension rather than an incidental transfer, and it is said
  plainly in the README to a reader deciding whether to install it. No change
  obscures it.
- No analytics and no telemetry of this project's own is introduced: no beacon,
  no counter, no error reporting service, no usage report, and no remotely
  hosted font, stylesheet, script or image on any of its documents.
- The documents, the tests and the fixtures in this repository use invented
  material. No real page content, personal data or credential appears in them.

### 1.8 The Quality of a Summary
This is the policy the extension exists for, and it decides what a change to the
prompt, to extraction or to shaping is allowed to do.

- **The task is semantic compression, not shortening.** Reducing a character
  count is not the purpose and is not the measure. A summary that is short and
  has lost the condition a claim depends on has failed; a summary that is long
  because the page carried little redundancy has not.
- The central claim of the page is kept.
- The main grounds for it, and the causal relations that matter, are kept.
- The conditions and reservations that could change the conclusion are kept.
- What matters for the kind of page it is, is kept: the purpose, the mechanism,
  the significant parts of a specification and the constraints of an explanatory
  page; the problem, the points at issue, where it stands and what is unresolved
  of a discussion.
- What is reduced, where it is not itself the substance, is repetition, several
  examples of one proposition, rhetorical elaboration, introductory
  throat-clearing, digression, redundant restatement, and supporting explanation
  that does not bear on the main line.
- **Nothing is added that the page does not carry**: no fact, no conclusion and
  no evaluation.
- **This is not fact checking, and is not to be confused with it.** Whether the
  page is correct, whether it is worth reading and whether it was written by a
  machine are not questions this extension answers, and no change introduces a
  judgement of that kind under the name of quality.
- No target length is imposed, and none is introduced by a later change: a dense
  page compresses less than a padded one, and that is the intended outcome.
- Where the page is a mixture, it is summarized as the mixture it is. No stage
  classifies a page first and applies a template to it afterwards.

### 1.9 Errors
- No failure is silent. Every failure ends the run, sets the failed state and
  shows the reader one message.
- A cause the reader can act on is shown in terms they can act on: what happened
  and what would address it.
- Causes that lead to different actions stay apart. "No token configured" and
  "the token was refused" are never merged into one message about the API.
- Distinguish, as far as the information allows, a failure to reach the endpoint
  from a failure of configuration, and both from a page that could not be read
  or that carried too little text.
- A message carries no internal detail: no exception, no stack, no status line,
  no response body, no request, and no part of the page.
- **A message never carries the API token**, and never carries the page's text
  or the summary in order to explain a failure.
- An unforeseen exception ends the run as a failure the reader is told about,
  rather than leaving the panel in a state that cannot be told from a run that
  never started.

### 1.10 Logging
- Keep the log to the minimum that makes a run explicable: one line at the end
  of a run, written with `console` in the service worker.
- What may be recorded is the shape of the run — the phase, the error kind and
  its detail, the HTTP status of a failure, the number of blocks, the character
  count and the elapsed time.
- **Never logged, at any level:** the API token and the `Authorization` header;
  the text of the page, whole or in part, including any block or excerpt; the
  page's title and its URL; the prompt; the request body; the response body; the
  summary.
- An exception object is never logged whole, because what it carries is not
  bounded by this design.
- There is no log level setting and no setting that turns any of the above back
  on. A diagnostic added while a fault is being chased is removed before the
  change is committed.

### 1.11 Dependencies
- **The initial version has no runtime dependency, no build step and no
  bundler**, and the directory that is committed is the directory Chrome loads.
  That is a property to be spent deliberately, not eroded.
- Do not add a dependency for something the browser's own APIs and the Chrome
  Extension APIs already do.
- A proposed dependency states what it is for, why the standard APIs do not
  serve, and what its licence is. Its licence must be compatible with the choice
  in §1.16.
- A dependency must be usable under Manifest V3 as packaged code. One that needs
  a remote script, `eval`, or a build step to exist at all is refused by what
  this extension is.
- **Nothing is loaded from a CDN or from any other host at run time.** Every
  script, stylesheet, font and image a document of this extension uses is
  packaged with it.
- A dependency that would run inside a page the reader is summarizing is the
  most sensitive position in this design, and is weighed as such.

### 1.12 Documents
- The documents of this repository have distinct responsibilities and do not
  take over each other's:
  - `README.md` is the entrance: what the project is, how it is installed, how
    the token is configured, how it is used, and its main limitations.
  - [`REQUIREMENTS.md`](REQUIREMENTS.md) states what is required and why.
  - [`BASIC_DESIGN.md`](BASIC_DESIGN.md) states what the extension is composed
    of and what each part is responsible for.
  - [`DETAILED_DESIGN.md`](DETAILED_DESIGN.md) states how each part behaves,
    down to the interfaces, the constants and the tables.
  - This document states how the repository is implemented and maintained.
  - [`doc/VERSIONS`](VERSIONS) is the release history.
  - [`LICENSE.md`](LICENSE.md) states the terms, and [`COPYING`](COPYING) and
    [`COPYING.LESSER`](COPYING.LESSER) hold the official licence texts.
- A change to behaviour updates the documents it makes wrong, in the same
  change. Leaving a design document describing what the code no longer does is
  not a smaller change; it is an incorrect one.
- **A change to a document does not change the implementation's specification.**
  Where a document and the code disagree, which one is wrong is decided by the
  order in §1.2, and the wrong one is corrected as its own change.
- **Do not document a feature, a setting or an operation that does not exist**,
  and do not write a document as though a planned change had been made.
- Where a document must state something the Sakura AI Engine owns — how a token
  is obtained, which models exist — the service's official documentation is the
  authority and is referred to rather than restated.

### 1.13 Pull Request Scope and History
A pull request presents the change it proposes, not the sequence of corrections
that produced it. It carries one purpose, and when the direction is revised part
way through a review, the branch is rewritten so that it reads as the change
finally intended, and merges as if it had been written that way.

#### 1.13.1 One Purpose to a Pull Request
- Changes that serve different purposes are proposed separately, as a rule, even
  when they touch one file and even when one was noticed while the other was
  being made. A pull request is accepted or rejected whole, and a mixed one
  leaves no way to take the part that is wanted.
- A change noticed in passing is proposed on a branch of its own. It is not
  carried along because the working tree happened to be open at it.
- Where the separation is genuinely artificial, because neither part is correct
  or reviewable without the other, they are proposed together and the request
  says why.

#### 1.13.2 Keeping a Branch to Its Change
- A branch that carries one coherent change carries it as one commit. That
  commit is amended and force pushed with `--force-with-lease`, rather than
  gaining a further commit for each remark received.
- Commits such as "fix review comment", "address feedback" or "resolve conflict"
  describe the review rather than the change, and do not belong in the history
  that is merged.
- A branch is split into several commits only when it genuinely carries several
  independent changes. The reasoning is the one that decides a `doc/VERSIONS`
  bullet: coherence, not chronology.

#### 1.13.3 Leaving No Trace of the Correction
- Each revision is read against the base branch, not against the revision before
  it, so that a correction leaves no residue in the diff that is merged.
- A correction withdraws what it replaces. Code, comments and wording introduced
  by an earlier revision and since abandoned are removed, not left standing
  beside their replacement.
- Conflicts with the base branch are resolved by rebasing onto it, so that no
  merge commit enters the branch.
- A rewritten branch invalidates the copies others have fetched. Force pushing
  is confined to the branch under review, and the rewrite is stated whenever the
  branch is shared.
- No commit message, branch name, pull request or fixture quotes a real page's
  content. A defect is described by what it did, not by the page that triggered
  it.

### 1.14 Versioning
- **[`doc/VERSIONS`](VERSIONS) is the release history of this repository**, and
  the authority for what a release contained. It is not a commit log.
- Release versions follow Chrome's extension version format: one to four
  dot-separated integers between 0 and 65535, with no leading zero in a
  multi-digit integer and with at least one non-zero integer.
- This repository uses three integers from that format and starts at v1.0.0.
- Work that is not released yet takes no version of its own: it belongs to the
  entry already standing at the top of `doc/VERSIONS`.
- **An unreleased entry carries `(Release Date: TBD)`.** Releasing it is
  replacing `TBD` with the date, and that edit is the release rather than a
  change to record.
- The version number an entry is released under is decided from what the entry
  actually accumulated, by the maintainer, at the moment of release. A number
  standing over an unreleased entry is provisional until then.
- **Do not split one release into finely divided versions.** Changes that belong
  to the same release belong to the same entry, however many commits produced
  them.
- **A documentation-only change does not become a version of its own**, and
  takes no entry unless its scale makes it worth one line saying so. Wording,
  formatting and comment changes with no effect on behaviour are not releases.
- An incompatible change — one that makes an existing configuration behave
  differently, or that requires the reader to do something before the extension
  works as before — is described as such in its entry, and the number it is
  released under is chosen then.
- `manifest.json` carries the `version` Chrome reads. It states the version
  being released when a release is made, and `doc/VERSIONS` remains the history.

#### 1.14.1 The Structure of doc/VERSIONS
- Each entry opens with a heading of the form `vX.Y.Z (YYYY-MM-DD)`, or `vX.Y.Z
  (Release Date: TBD)` while it is unreleased, underlined with `-` characters,
  followed by one `-` bullet per change.
- Write one coherent change on one physical line, qualified as below for a file
  that has settled on a form of its own. The file is read as a list and reviewed
  as a diff, and both are served by an entry that is not wrapped.
- That rule comes before the roughly 80 columns a plain text document otherwise
  aims at. Near 100 columns is the usual target, and an entry that has to name a
  file, an API, a constant or a setting may run to about 120 columns.
- That is a deliberate exception in this file. Do not rewrap `doc/VERSIONS` to
  80 columns, and do not report a long entry there as a violation of that width.
- Where the file has settled on a width of its own, a new entry is wrapped to
  that width and balanced against the lines already standing, so that the
  history stays of a piece. Entries already written are not reflowed to suit a
  new one.
- When an entry runs long, look first for what can be dropped or abstracted —
  the implementation detail, the example, the detailed reason, the secondary
  effect — before wrapping the line.
- Keep the changed target, the behaviour visible from outside, the effect on
  compatibility, the effect on privacy or security, and the identifiers that
  matter.
- Merge changes that serve one purpose within a version, place entries that
  touch the same part near each other, and append an independent change to the
  end of that version.
- `doc/VERSIONS` carries these guidelines again at its foot, and an entry
  written into it follows the reasons recorded there.

### 1.15 Document Format
- The format of a document is decided by what it is for and by the name it
  carries, not by whether part of its content happens to parse as Markdown.
- A document named with `.md` is written, displayed and maintained as Markdown:
  headings, lists, tables, code blocks and links make its structure explicit,
  and it may assume it will be rendered. Prose is wrapped near the width the
  document already uses; a URL, a table row, a code block or an identifier may
  run long, and the roughly 80 columns plain text aims at is not applied to it.
- A document that carries no extension is a plain text document, read raw in a
  terminal, a pager or a diff. Its prose stays near 80 columns as far as it
  practically can, and nothing in it assumes a Markdown renderer. Underlined
  headings and dashed lists are readable everywhere, and finding them there does
  not make it Markdown.
- `doc/VERSIONS` keeps its name and its plain text form. It is not renamed to
  `.md` because it contains a symbol a renderer would accept.
- `doc/COPYING` and `doc/COPYING.LESSER` keep the extensionless names by which
  the licence texts are recognised. Their official names and their legal wording
  come first, and neither is renamed or reformatted for uniformity.
- `doc/LICENSE.md` carries `.md` because it is the document a reader is shown.
  It and the licence texts have different roles, so having both is neither a
  duplicate nor an inconsistency.
- An existing document is not renamed to add or change an extension. A path here
  is a public URL that the README and pages outside this repository link to.
- Bringing every document to one extension and one line width is not a goal.
  What is kept uniform is the criterion by which a document's form is chosen,
  not the appearance of the documents.

### 1.16 The Language of the Repository
- The code, the comments, the identifiers, the documents, the screens and the
  prompt are written in English.
- A summary is written in the language of the page being summarized, which is
  the prompt's business and not the code's.

### 1.17 License
- The repository is dual licensed under the GPL version 3 or the LGPL version 3,
  at the user's option, as stated in [`LICENSE.md`](LICENSE.md). The full texts
  live in [`COPYING`](COPYING) and [`COPYING.LESSER`](COPYING.LESSER), and are
  kept verbatim.
- A dependency is added only when its licence is compatible with that choice.

### 1.18 Judging a Change
Before a change is proposed, it answers these:

- Does it cross an Invariant? Then it is not made.
- Does it need the requirements or a design document to say something they do
  not? Then those documents change first.
- Does it lengthen the path from clicking the action to reading the summary?
- Does it move a decision about how a summary reads out of the prompt and into
  JavaScript?
- Does it widen what leaves the browser, what is stored, or what a log carries?
- Does it widen the permissions, or the set of origins that can be reached?
- Does it add a dependency, and does that dependency earn its place?
- Is it the smallest change that serves its purpose?
- Does a test fail without it?
- Which documents change with it: the README, the requirements, the designs,
  this policy, `doc/VERSIONS`?

A change that is correct but cannot be explained by the requirements is a sign
that the requirements are incomplete, and that is where it is taken.

---

## 2. Chrome Extension Policy

### 2.1 Manifest V3
- **Manifest V3 is the premise**, not a target to migrate to and not one to
  migrate from. `manifest.json` declares `"manifest_version": 3`, and nothing is
  written against a Manifest V2 behaviour.
- The background context is a service worker, and it is treated as one: it may
  be terminated between events at any time, so nothing that has to survive a run
  is kept in a variable it happens to still hold.
- `minimum_chrome_version` states the version the APIs actually used require, so
  that an older browser refuses the extension rather than failing at the first
  click. It is raised when a newly used API requires it, not speculatively.
- **Prefer the Chrome Extension API to an implementation of our own.** Where the
  platform provides the storage, the injection, the panel, the options page or
  the messaging, that is what is used.
- Use a documented, stable API. Do not depend on undocumented behaviour, and do
  not work around a platform behaviour by reaching outside the extension model.

### 2.2 Permissions
- **Permissions are the minimum the design needs**, and each one earns its place
  by a use that exists in the code. `activeTab`, `scripting`, `storage` and
  `sidePanel` are the whole of them.
- **The host permission names the Sakura AI Engine origin and nothing else**, so
  that a request anywhere else is refused by Chrome rather than by this policy
  being obeyed.
- **No host permission for the sites the reader visits.** Access to a page comes
  from `activeTab`, granted by the reader's click and lasting no longer.
- **No `tabs`, `history`, `webNavigation`, `bookmarks` or `alarms`.** Each would
  be the machinery for watching a reader rather than answering one.
- **No `content_scripts` declaration**, so nothing of this extension is loaded
  into a page that was not summarized.
- A permission is not added to make an implementation easier. Adding one is a
  change to the privacy properties of the extension, and it is proposed as that:
  what it grants, why the design cannot do without it, and what it costs the
  reader.
- No permission is requested at run time to widen what the manifest declares.

### 2.3 Only on the Reader's Action
- **A run begins only from the reader's explicit action.** The toolbar action
  click is the only way.
- **Nothing watches.** No listener starts a run, no navigation triggers one, no
  schedule exists, and no page is read because it happened to be open.
- A listener that exists for housekeeping — discarding the stored state of a tab
  that has closed or navigated — reads no page, holds no URL and starts no work.
  That is the limit of what such a listener may do.
- A run for a tab that is already running is ignored rather than queued or
  restarted.

### 2.4 The Content Security Policy and Code Loading
- The extension pages' CSP is declared in the manifest and is followed rather
  than relaxed. A change that would need it widened is the wrong change.
- **No remote code.** No script, stylesheet, font or image is fetched from
  another host, and nothing is loaded from a CDN.
- **No dynamic code execution.** `eval`, `new Function`, `setTimeout` with a
  string argument, and dynamic `import()` of a remote URL are not used.
- **Nothing received from the AI Engine is ever executed**, and nothing received
  from a page is either.
- The only `fetch` to a network origin is the one in the engine client. A
  `fetch` of a packaged resource through `chrome.runtime.getURL` is not a
  network request and is the only other one.

### 2.5 The Page Is Untrusted
- **The content of a web page is untrusted input.** It is the text being
  summarized, and nothing found inside it is an instruction to this extension or
  to the model.
- The extraction pass reads the document and never writes it: it adds no node,
  sets no attribute, registers no listener and calls no function belonging to
  the page. It holds no setting and no token, so there is nothing in it to leak.
- What comes back from an injected pass is validated before it is used, in shape
  as well as in type. A result that is not what was asked for is a failure of
  the run, not something to repair into a shape that passes.
- Text taken from a page never becomes a selector, a URL, a storage key or code.
- The delimitation between the instruction and the material is structural — a
  separate message — rather than a marker inside one string that a page could
  contain.

### 2.6 Output to the DOM
- **Text is written to a document with `textContent`.** `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `document.write` and `DOMParser` are not
  used.
- No markup from the page, from the model or from a setting is rendered, and no
  Markdown is rendered. The initial version therefore needs no sanitizer — a
  decision that removes a class of problem instead of defending against it.
- A change that would need HTML to be constructed from a string needs this rule
  changed first, and that is a change to the security design.
- The panel and the options page are extension documents with their own styling.
  They neither reach into a page nor are reachable from one.

### 2.7 The Sakura AI Engine
- **BYOK is maintained.** The reader's own API token is the only way a request
  is made, and no arrangement is added under which a page is summarized without
  one.
- **No token is written into the source**, committed to this repository — not
  even as a sample value — or embedded in anything distributed.
- **No token is sent to a backend belonging to this project**, because there is
  none, and none is added to receive one.
- The token is held in the reader's own profile, in extension storage, and
  travels only as the value of one `Authorization` header to the one origin the
  manifest names. It reaches no URL, no page, no document of this extension
  other than the field it is entered in, no message shown to the reader and no
  log line.
- The token field is never prefilled from storage; whether a token is configured
  is stated instead.
- **The official Sakura AI Engine documentation is the authority** for the API,
  the endpoint and the models. The request is the documented one and the answer
  is read as documented; no wrapper protocol of this project's own is invented.
- **No unnecessary fixed dependence on a particular model.** The model is a
  setting with a documented default, the default name appears in exactly one
  place, no prompt is tuned to a model and no behaviour branches on which one is
  configured.
- What the service owns is not restated here or in the code: the list of
  available models is not fetched, not embedded and not maintained in this
  repository.
- Only what the summary requires is sent: the instruction and the shaped content
  of the page the reader asked about. Nothing retrieved, nothing searched,
  nothing from an earlier run.

### 2.8 Settings and State
- **The two settings are the token and the model**, and they live in
  `chrome.storage.local`. Nothing else is a setting.
- The endpoint, the timeout, the size budget, the minimum length and the prompt
  are design constants and resources, not settings: none is something a reader
  has the information to choose, and each one exposed would be a second decision
  on a path that is meant to stay at one.
- Adding a setting is adding a decision to the reader's path, and is proposed as
  that. A value with one correct answer is a constant with a comment saying why.
- The state of a run lives in `chrome.storage.session`, keyed by tab, so that it
  survives the service worker being terminated and is gone when the browser
  closes. No state management framework, no store, no persisted history.
- One place names the storage keys, and nothing else names one.

### 2.9 The Prompt
- The prompt is a packaged text resource under `prompts/`, read at run time. No
  module contains its wording.
- **Improving the summaries is editing that file.** A rule about what a summary
  keeps, what it drops, how long it is or how it reads belongs there, not in a
  branch in JavaScript, unless the rule is mechanical and cannot be expressed as
  an instruction.
- The prompt is substituted into nothing and formats nothing: the instruction
  reaches the request unchanged.
- A prompt resource that cannot be read ends the run as a failure. No built-in
  text stands in for it, because a summary written by a fallback prompt would be
  indistinguishable from one written by the intended prompt.
- A change to the prompt is weighed against §1.8, and against the requirements
  it serves, in the same change.

---

## 3. JavaScript Policy

### 3.1 Structure
- Plain modern JavaScript, in ES modules, run by Chrome and by Node for the
  tests. No transpiler, no bundler and no framework.
- **Browser standard APIs and the Chrome Extension APIs come first.** A utility
  library is not added for what the platform already provides.
- Comments are written in English and say why, not what. Where a decision looks
  arbitrary — a listener that is load bearing, a check that must happen before
  an `await`, a constant with a reason behind its value — the comment gives the
  reason, so that a later change does not quietly undo it.
- Every JavaScript module opens with a short comment saying what it is
  responsible for and what it may not do. That header is part of the module's
  specification, and a change that makes it wrong updates it.
- A comment and a document quote no real page content.
- Name a thing by what it is. A name that reaches for the container, the API or
  the interface instead of the thing itself loses the distinction the code
  exists to keep.

### 3.2 Separation of Concerns
- The responsibilities of the extension stay in separate modules, and the
  direction of dependency between them points one way: the service worker knows
  all of them, and none of them knows it.
  - **The service worker** orchestrates one run and holds its state. Every
    decision in a run is taken there, so that there is one place to read when
    the question is what happened.
  - **Extraction** turns one document into an ordered list of blocks, and does
    nothing else. It is injected as a file, so it takes no import and is
    self-contained; it takes the document as an argument rather than reaching
    for a global.
  - **Shaping** turns blocks into the material, and judges its size. It is pure:
    no `chrome` API, no storage, no clock, no randomness, no network.
  - **The engine client** owns every detail of talking to the AI Engine — the
    endpoint, the header, the body, the timeout, the shape of the answer and the
    mapping of a failure to an error kind. Nothing else knows any of them.
  - **The panel** renders the state. It decides nothing, holds no setting and no
    token, performs no extraction and makes no request to the AI Engine.
  - **The options page** reads and writes the two settings, and nothing else.
  - **The common modules** hold the storage keys and the model default, the
    error kinds and their messages, and the message names. They import nothing
    of their own.
- A new responsibility goes to the part that owns it. Where it appears to belong
  to two, the boundary is wrong and is corrected, rather than the code being
  written across it.
- **The reader-facing message for a failure is composed in one place**, from the
  error kind alone. Nothing else in the extension composes one, and nothing is
  interpolated into one from the page, the answer or the settings.

### 3.3 State and Side Effects
- **Do not grow global state.** A run is contained in the call that performs it;
  what has to outlive the call goes to the state the design provides, keyed by
  tab.
- Module-level bindings are constants — a key, a limit, a pattern, a table. A
  module-level mutable variable is a fact two runs can see, and is not
  introduced.
- A module's import must have no side effect that a test cannot tolerate. A file
  that wires listeners or a document does so behind a guard, so that importing
  it in Node registers nothing.
- A function that can be pure is written pure, and the ones the design names as
  pure stay that way.

### 3.4 Asynchrony and Failures
- **No rejection is left unhandled and no error is swallowed.** Every `await` of
  something that can fail sits inside a path that decides what the failure
  means.
- A `catch` that intentionally ignores a rejection says why in a comment, and is
  used only where the outcome genuinely does not matter — a broadcast with no
  listener, a state removal for a tab that has gone.
- Every outbound request is made under an explicit bounded wait, which covers
  reading the body as well as the response. There is no request without one.
- A failure crossing a module boundary is one of the design's error kinds. A
  status, an exception or a message fragment does not cross it.
- **A failed run is never retried automatically.** Retrying is the reader
  clicking again.
- An exception nobody predicted still ends the run as a failure the reader is
  told about.

### 3.5 Tests
- The tests are Node's own runner: `node --test tests/*.test.mjs`, with
  `node:test` and `node:assert/strict`, and no test framework, no assertion
  library and no mocking library.
- **No test performs network access, and none needs a token, a browser profile
  or a real endpoint.** The engine client takes its `fetch` and its timeout as
  parameters so that a stub answers without a network and a timeout is provable
  in milliseconds.
- The error kind is the only thing that crosses a boundary on failure, so a test
  of what happens downstream of one asserts a kind rather than a message
  fragment, a status or an exception. The messages themselves are tested where
  they are defined.
- A test writes nothing outside a temporary directory.
- Test material is invented. No real page content and no real credential is
  used, and a defect found on a real page is reproduced with material written
  for the test.
- A fix for a defect arrives with the test that fails without it.
- The runner exits `0` only when every test passed. A passing suite says nothing
  about the endpoint being reachable; only an actual run does.
- Some tests guard an Invariant rather than a feature — that the token appears
  in nothing the engine client returns is one of them. A test written to guard
  an Invariant is not deleted to make a refactor pass.
