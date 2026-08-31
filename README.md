# web-digest

## Contents

1. [Overview](#overview)
2. [Features](#features)
3. [The pages it is pointed at](#the-pages-it-is-pointed-at)
4. [Requirements](#requirements)
5. [Installation](#installation)
6. [Preparing an AI provider](#preparing-an-ai-provider)
7. [Configuration](#configuration)
8. [Usage](#usage)
9. [How it summarizes](#how-it-summarizes)
10. [Privacy](#privacy)
11. [When something fails](#when-something-fails)
12. [Limitations](#limitations)
13. [Not built](#not-built)
14. [Repository structure](#repository-structure)
15. [Documents](#documents)

## Overview

**web-digest** is a Chrome extension that takes the page you currently have open, extracts its main content, and produces a short summary of it with an AI provider of your choice: the Sakura AI Engine (さくらの AI Engine), OpenAI, or Claude.

**The task is semantic compression, not shortening.** A summary that is short and has lost the condition a claim depends on has failed; a summary that is long because the page carried little redundancy has not. What the summary keeps is the central claim, the main grounds for it, the causal relations that matter, the conclusion, and the conditions and reservations that could change it. What it removes is repetition, several examples of one proposition, rhetorical elaboration, introductory throat-clearing and digression.

The summarizing is done by the provider you selected in settings, through your own API credential for it. There is no server belonging to this project: the extracted content and that provider's credential are sent only to the one provider you selected, and this project itself collects nothing.

```text
open a page
↓
click the toolbar action
↓
the main content of that page is extracted
↓
it is sent to your selected AI provider with your own credential
↓
the summary is shown in the side panel, beside the page
```

- Requirements: [doc/REQUIREMENTS.md](doc/REQUIREMENTS.md)
- Basic design: [doc/BASIC_DESIGN.md](doc/BASIC_DESIGN.md)
- Detailed design: [doc/DETAILED_DESIGN.md](doc/DETAILED_DESIGN.md)
- Implementation policy: [doc/POLICY.md](doc/POLICY.md)
- Version history: [doc/VERSIONS](doc/VERSIONS)

## Features

- **General web pages**: there is no list of supported sites and no site-specific handling; the extraction is one generic strategy
- **Only the page you asked about**: nothing runs until you click, no page is read because it happened to be open, and no run starts on a navigation or on a schedule
- **A choice of AI provider**: Sakura AI Engine, OpenAI or Claude, selected in settings; one run uses exactly the one provider you selected, and never sends anything to the other two
- **Substance kept, redundancy dropped**: the central claim, the causal relations that matter, the conclusion and the conditions that qualify it survive the summary
- **No target length**: the length that results from removing the redundancy of a particular page is the length that page gets
- **Optional Japanese summary output**: off by default, the summary is written in the page's own language; turn on **Summarize in Japanese** in settings to have it written in Japanese instead, regardless of the page's language — this applies to every provider alike
- **Your selected provider does the summarizing**: the extension prepares the material, asks for the summary and displays what comes back
- **Bring your own key**: your own API credential for your selected provider is used, and this project holds none and supplies none
- **Existing Sakura users need no changes**: Sakura AI Engine is the default provider, and an existing token, model and Japanese summary preference keep working exactly as before, with no migration
- **No backend of its own**: there is no server belonging to this project anywhere in the design
- **Nothing accumulates**: no browsing history, no page text, no summary and no credential is stored on a server of this project's, because there is none
- **Read beside the page**: the result appears in Chrome's side panel, so the page it came from stays visible and untouched
- **No build step and no dependency**: the directory you clone is the extension you load

## The pages it is pointed at

Ordinary web pages whose main content is prose. There is no list of supported sites, and none is needed for the extension to be useful: technical articles, blogs and essays, news articles, technical documentation, a GitHub README or issue, product and specification descriptions, FAQs, forum threads and long posts are all pages it is expected to be used on.

**That is not a compatibility list.** It is a description of what kind of page has something to compress. Nor is complete extraction promised: an unusual DOM, content generated after load, a shadow tree, and a page that depends on an authentication state may all leave too little text to work with. That is an ordinary outcome rather than a defect, and it is reported as itself — see [Limitations](#limitations).

## Requirements

- Google Chrome 116 or later. `chrome.sidePanel` itself arrived in 114, but the `sidePanel.open()` this extension calls needs 116, and the manifest states that so an older browser refuses the extension rather than failing at the first click.
- An environment able to use at least one of the three supported AI providers, and an API credential of your own for it: the Sakura AI Engine, OpenAI, or Claude.
- Outbound HTTPS access to the origin of whichever provider you select — `https://api.ai.sakura.ad.jp`, `https://api.openai.com` or `https://api.anthropic.com` — and nothing else.

There is nothing to build and nothing to install alongside it. No bundler, no transpiler, no package manager and no third-party library: the files a browser is given are the files in the repository.

## Installation

The extension is **not published on the Chrome Web Store.** It is obtained from this repository and loaded through Chrome's developer mode, as an unpacked extension.

```bash
git clone https://github.com/id774/web-digest.git
```

Then, in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the cloned `web-digest` directory — the directory that contains
   `manifest.json`. Do not select the `manifest.json` file itself. **The repository
   root is the extension**; there is no build output or subdirectory to select.
5. Open Chrome's **Extensions** menu at the top right of the browser.
6. Find **web-digest** and pin it.
7. Confirm that the **web-digest** button appears on the Chrome toolbar.

Nothing runs at this point. The extension does nothing until you click its toolbar action on a page.

## Preparing an AI provider

Pick one of the three supported providers and obtain your own API credential for it. **This project holds no credential of its own and supplies none to anybody**, and there is no arrangement under which a page is summarized without a credential of yours.

| Provider | Credential | Where to obtain it and its model names |
| --- | --- | --- |
| Sakura AI Engine | an API token | the Sakura AI Engine's own official documentation |
| OpenAI | an API key | OpenAI's own official documentation |
| Claude | an API key | Anthropic's own official documentation |

**Each service's official documentation is the authority** for obtaining a credential and for the model names it currently offers, and this README deliberately does not restate a procedure or a model name that a service owns and can change.

If you do nothing, the extension behaves as **Sakura AI Engine** selected — this is unchanged from earlier versions, so an existing Sakura user upgrading needs to change nothing. A new user picks a provider explicitly in settings, as described below.

## Configuration

The configurable settings are listed below. Their storage keys and the default model
for each provider are defined in `src/common/settings.js`, and the stored values live
in `chrome.storage.local` in your own Chrome profile.

| Setting | Required | Default | What it decides |
| --- | :---: | --- | --- |
| AI provider | no | Sakura AI Engine | Which of the three providers a run uses. |
| API credential (per provider) | yes, for the selected provider | — | The credential the request to that provider is made with. |
| Model (per provider) | no | a name recorded in `src/common/settings.js`, one default per provider | Which model the selected provider summarizes with. |
| Summarize in Japanese | no | off | Off: the summary is written in the page's own language. On: the summary is written in Japanese, regardless of the page's language. Applies to every provider alike. |

Each provider's credential and model are stored under their own keys and are
independent of one another: switching the selected provider never deletes,
overwrites or moves another provider's stored credential or model, and never
asks you to re-enter one.

### First-time setup

After loading and pinning the extension, configure a provider:

1. Open `chrome://extensions`.
2. Find **web-digest** and open **Details**.
3. Choose **Extension options** to open the settings page.
4. Choose your **AI provider**. Leave it as **Sakura AI Engine** to keep the
   previous default, or choose **OpenAI** or **Claude**. Choosing OpenAI or
   Claude for the first time asks Chrome's own permission prompt for that
   provider's API origin — grant it to continue, or the provider selection is
   not changed.
5. Enter your own API credential for the selected provider.
6. To use a different model, enter its name in **Model**. Otherwise, leave it empty
   to use that provider's default.
7. Choose **Save**.
8. Confirm that **Saved.** and **A credential is configured.** are shown.

After saving, the credential field becomes empty. This is normal: a stored credential
is never displayed again. The line **A credential is configured.** confirms that it
was saved.

The settings page also opens from **Settings** in the side panel's header. When a run
fails because no credential is configured, choose **Open settings** in the side panel.
Use either route whenever you need to change the provider, its credential, or its
model.

The settings page carries:

- **AI provider**, a selector for Sakura AI Engine, OpenAI or Claude. Selecting
  OpenAI or Claude for the first time requests the browser permission that
  provider needs; denying it leaves the previous provider selected and
  changes no stored credential or model.
- **API credential**, a password field for the selected provider. It is **never
  prefilled**, whatever is stored; a line beside it says whether a credential is
  configured for that provider.
- **Model**, a text field for the selected provider, prefilled with that provider's
  stored value. Leaving it empty means that provider's own default.
- **Save**, which validates both fields locally and writes them for the selected
  provider only. A credential is refused when it is empty or contains a space or a
  line break; a model name is refused when it contains a space. **Nothing is checked
  by contacting the provider** — a credential that does not work is discovered by the
  first run that uses it.
- **Delete credential**, which removes the selected provider's credential and leaves
  its model, every other provider's settings, the provider selection and the Japanese
  summary preference alone. Saving with an empty credential field is refused rather
  than treated as a deletion, so an accidental save cannot clear a working credential.
- **Grant or restore permission**, visible only when the selected provider is OpenAI
  or Claude. It requests that provider's optional browser permission directly, without
  changing the selected provider, its credential, its model or the Japanese summary
  preference — useful if that permission was later removed or revoked in Chrome.
  Sakura AI Engine's permission is required, so it does not need this control.
- **Summarize in Japanese**, a checkbox reflecting the stored preference, shared by
  every provider. Changing it saves that preference on its own, immediately,
  independently of **Save** — it never requires a credential to be re-entered.

The endpoint, the timeout, the size budget and the summarization prompt are design constants and resources rather than settings. None of them is something a reader has the information to choose, and each one exposed would be a second decision on a path that is meant to stay at one.

### Credentials and permissions

- **No API credential is written into the source code**, and none is committed to this repository, including as a sample value.
- **Your credential stays in your own browser profile**, in `chrome.storage.local`, until you delete it, and each provider's credential is stored under its own key, independent of the others.
- It is used as the value of one authentication header or field, to one origin: the origin of the provider it belongs to, and no other.
- **It is never sent to a backend belonging to this project**, because there is none. It reaches no log, no error message, no page and no part of the side panel.
- Sakura AI Engine's host permission is required and is always present. OpenAI's and Claude's host permissions are optional, and Chrome asks for the one you need at the moment you select that provider in settings. If that permission is later removed or revoked in Chrome's own settings, use **Grant or restore permission** on the selected OpenAI or Claude provider to request it again — never when a run starts, and never for a provider you have not selected.

One thing this does not promise: a credential held by a browser extension is not a secret kept from the person at the keyboard. Whoever controls the Chrome profile can read extension storage, and no arrangement inside an unpacked extension changes that.

## Usage

After the first-time installation, pinning and provider setup, follow these steps for
each page:

1. Open the web page you want summarized.
2. Click the **web-digest** button on the Chrome toolbar.
3. The side panel opens on the right, and the summary run starts automatically from
   that same click.
4. While the run is in progress, the side panel shows **Summarizing… this can take a
   while.**
5. The extension extracts the page's main content and sends it to your selected AI
   provider with your credential and configured model for that provider.
6. When the run succeeds, the page title and summary appear in the side panel beside
   the original page.

To summarize the same page again, click the **web-digest** toolbar button again.
The toolbar action is the only control that starts a summary.

What the panel shows:

| Phase | What you see | Control |
| --- | --- | --- |
| nothing run yet | that no summary has been run for this tab | **Settings** |
| in progress | that a summary is being produced, and that it may take a while | **Settings** |
| succeeded | the title and the summary | **Settings** |
| failed | what went wrong, and what would address it | **Settings**; additionally **Open settings** when no credential is configured, or a permission is missing |

Navigating to another page never starts a run: the panel returns to "nothing run yet" for the new page and waits for the toolbar action. A failed run is never retried automatically. One toolbar click starts one complete run, with one provider fixed for its whole duration; a long page may require several requests to that same provider within that run.

## How it summarizes

What the summary keeps follows from what the page is, and no stage decides which kind of page it is first — there is no classifier, no per-kind branch and no mode to select. A page that is a mixture is summarized as the mixture it is.

| The page is | What is kept |
| --- | --- |
| an essay or an article | the central claim, the main grounds for it, the causal relations that matter, the conclusion, and the conditions and reservations that could change that conclusion |
| an explanatory text or technical documentation | the purpose, the main mechanism, the significant parts of the specification, the conditions of use, and the constraints |
| an issue or a discussion | the problem, the main points at issue, the material a judgement would rest on, where it currently stands, and what remains unresolved |

What is reduced, where it is not itself the substance: repetition of the same content, several examples illustrating one proposition, rhetorical elaboration, introductory throat-clearing, digression, redundant restatement, and supporting explanation that does not bear on the main line.

**A character count is not the constraint.** The summary is not trimmed mechanically to a target length; the measure is that the redundancy is gone and the substance is intact. Two consequences are intended: a dense page compresses less than a padded one, and two pages of the same original length do not produce summaries of the same length.

Nothing is added that the page does not carry — no fact, no conclusion and no evaluation. The text of the page is material, never instruction: a sentence inside a page that addresses a model is part of the text being summarized.

**By default, the summary is written in the language of the page.** Turning on **Summarize in Japanese** in settings writes the summary in Japanese instead, directly, regardless of the page's language — the page is never first summarized in its own language and then translated. This preference is the same whichever provider is selected. It is read once when a run starts and used for that whole run, so a long page's chunk summaries and its integrated summary always share the same output language. This is not a standalone translator: there is no separate translation result, and nothing but the summary's own language changes.

How a summary is written is decided by `prompts/summarize.md`, outside the code, and by the one instruction it holds for whichever provider a run uses. Improving the summaries is editing that file.

## Privacy

- **The content of a page is read only when you have asked for a summary of that page**, at the moment you asked. Nothing of this extension is loaded into a page that was not summarized, and no run reads a tab other than the one it was asked about.
- **No browsing history is collected.** The extension holds no `history` and no `tabs` permission, and the page's URL is never read, never returned by extraction, never stored and never sent.
- **The main content of the page you asked about is sent to your one selected AI provider**, together with the summarization instruction, because that is where the summary is produced. One run uses exactly one provider; nothing is sent to the other two, whether or not you have granted them permission. This is the point of the extension rather than an incidental transfer, and it is worth knowing before you install it.
- **There is no backend belonging to this project**, so there is nowhere for a page, a summary, a credential or a history to be sent to or to accumulate in. That is a property of the design rather than a promise not to look.
- **No page text and no summary is written to disk.** The result of the last run is held in session storage, per tab, and is gone when the browser closes, when the tab closes, or when the tab navigates elsewhere.
- **Each credential reaches one origin**, as one header or field, and no other: the origin belonging to the provider it was entered for.
- **This project does not control what your selected provider does with what it receives.** Its own data handling — retention, logging, training use — is that provider's own policy, stated in its own documentation; this project makes no claim about it beyond what it itself sends and stores, which is nothing.

The permissions are the smallest set that allows this: `activeTab` for the tab you acted on and no longer, `scripting` to read it once, `storage` for the extension settings and the state of the last run, `sidePanel` for the display, one required host permission naming the Sakura AI Engine origin, and two optional host permissions — OpenAI's and Claude's — requested only from your own action in **Settings**, when you select that provider there or when you choose **Grant or restore permission** for the one already selected, never when a run starts. There is no host permission for any site you visit, so a request to anywhere else is refused by Chrome rather than by this design being obeyed.

## When something fails

Every failure ends the run and shows one message in the panel that names the cause and what would address it: that no credential is configured for the selected provider and where to enter one, that the credential was rejected, that the selected provider could not be reached or took too long or reported an error, that a browser permission for the selected provider is missing, that the content of this page could not be obtained, that this page has too little text, that this page is too large to process, that no usable summary came back, or that the extension itself failed to complete the run.

Causes that lead to different actions stay apart — "no credential" and "credential rejected" are never merged into one message about the provider. A message carries no status line, no response body, no internal detail and no API credential. What a status code was is recorded in the service worker's console log, which carries counts and durations and never the page's text, its title, its URL, the prompt, the request, the answer or the summary.

For the most common problems:

- **The web-digest button is missing:** Open Chrome's **Extensions** menu, find
  **web-digest**, and pin it to the toolbar.
- **The panel says no credential is configured:** Choose **Open settings**, or open the
  extension's options from `chrome://extensions`, and save a credential for the
  selected **AI provider**.
- **The panel says a browser permission is missing:** Open **Settings** and choose
  **Grant or restore permission** for the selected OpenAI or Claude provider.
- **The page cannot be summarized:** Try an ordinary web page. Unusual page
  structures and pages where Chrome does not allow extension scripts — including
  Chrome internal pages — may not be readable.
- **The selected AI provider reports an API error:** Check the credential, model name
  and availability of your account or service with that provider.

## Limitations

- **Extracting the main content of every page is not promised.** An unusual DOM, content generated after load, a shadow tree, a page behind an authentication state, and a page built in a way the generic strategy does not recognize may all yield too little text. The run says so rather than summarizing whatever furniture happened to be extractable.
- **Some pages cannot be read at all**: `chrome://` pages, the Chrome Web Store and the Chrome PDF viewer are restricted by Chrome itself, and script injection into them is refused. `file://` URLs are not refused across the board — if you have turned on **Allow access to file URLs** for this extension in Chrome's extension details, a `file://` page can be read the same as any other page; if that permission is off, injection is refused and the run reports that this page's content could not be obtained.
- **The summary is produced by a language model.** It is not a guarantee that the meaning of the original survived, and it is no substitute for the page where a judgement actually matters — read the original before deciding anything on it.
- **It reports what the page says.** Whether the page is correct, whether it is worth reading, and whether it was written by a machine are not questions this extension answers.
- **A very long page is summarized in stages.** Material within the 200,000-character request budget uses one request. Longer material is split at heading and block boundaries, each chunk is semantically compressed, and the chunk summaries are integrated into one whole-page summary. Integration is repeated in stages when necessary; content is not sampled or ranked away. Every stage of a long page's summary uses the same one provider a run started with.
- **A page with too little text is declined too**, for the same reason: there is nothing to compress.
- **Requests are not streamed.** A normal page uses one request; a long page uses the staged requests needed to preserve and integrate its content. The panel says the run is in progress while it waits.
- **The summary is displayed as plain text.** No markup from the page and none from the model is rendered — a decision that removes a class of problem rather than defending against it.
- **The interface is English**, and it is not translated.
- **A run never falls back to another provider.** If the selected provider fails, times out, or its permission is missing, the run ends as that failure; it is never retried against a different provider automatically.

## Not built

Deliberately absent from this version, and not prepared for anywhere in the design: publication on the Chrome Web Store; official support for Firefox, Safari or Edge; a backend server belonging to this project; user accounts; billing; a shared API credential supplied to readers; collecting browsing history; storing summaries in the cloud; summarizing across several pages; web crawling; summarizing on a schedule; retrieval-augmented generation; a vector database; integration with web search; fact checking; judging whether a page is good, correct or machine-generated; a standalone translator, as distinct from the summary's own output-language setting; a custom or user-editable endpoint for any provider; a fourth AI provider, or an OpenAI-compatible, Azure OpenAI, Amazon Bedrock or Google Vertex AI provider; automatic fallback or a race between providers; and a large body of site-specific implementations.

None of these is a gap to be filled later. Should one become necessary, the requirements change first and the design follows.

## Repository structure

```text
.
├── manifest.json
├── package.json
├── icons/
├── prompts/
│   └── summarize.md
├── src/
│   ├── background/
│   ├── extract/
│   ├── shape/
│   ├── engine/
│   ├── panel/
│   ├── options/
│   └── common/
├── tests/
├── README.md
└── doc/
    ├── REQUIREMENTS.md
    ├── BASIC_DESIGN.md
    ├── DETAILED_DESIGN.md
    ├── POLICY.md
    ├── VERSIONS
    ├── LICENSE.md
    ├── COPYING
    └── COPYING.LESSER
```

There is no build step, which is what makes "load unpacked from a clone" the whole of the installation. Four concerns are kept apart — obtaining the content of the page, communicating with the selected AI provider, the summarization prompt, and displaying the result — so that adding or changing a provider touches `src/engine/` and the settings.

Prompt wording is not embedded in a JavaScript module. `prompts/summarize.md` is a packaged text resource that the service worker `fetch()`es at the start of a run; improving the summaries is editing that one file, and no module holds a copy of its wording.

## Documents

- Requirements: [doc/REQUIREMENTS.md](doc/REQUIREMENTS.md)
- Basic design: [doc/BASIC_DESIGN.md](doc/BASIC_DESIGN.md)
- Detailed design: [doc/DETAILED_DESIGN.md](doc/DETAILED_DESIGN.md)
- Implementation policy: [doc/POLICY.md](doc/POLICY.md)
- Version history: [doc/VERSIONS](doc/VERSIONS)

REQUIREMENTS states what the extension must satisfy. BASIC_DESIGN states the architecture and the responsibility of each component. DETAILED_DESIGN states the concrete behavior and interfaces. POLICY states the implementation and maintenance policy. VERSIONS is the release history.

Each of them stands on its own. What this repository needs is written in this repository, and no document here is completed by one kept somewhere else. Where a document and this README disagree, the documents are right and this README is the one to correct.
