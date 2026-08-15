# web-digest

## Contents

1. [Overview](#overview)
2. [Features](#features)
3. [The pages it is pointed at](#the-pages-it-is-pointed-at)
4. [Requirements](#requirements)
5. [Installation](#installation)
6. [Preparing the Sakura AI Engine](#preparing-the-sakura-ai-engine)
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

**web-digest** is a Chrome extension that takes the page you currently have open, extracts its main content, and produces a short summary of it with the Sakura AI Engine (さくらの AI Engine).

**The task is semantic compression, not shortening.** A summary that is short and has lost the condition a claim depends on has failed; a summary that is long because the page carried little redundancy has not. What the summary keeps is the central claim, the main grounds for it, the causal relations that matter, the conclusion, and the conditions and reservations that could change it. What it removes is repetition, several examples of one proposition, rhetorical elaboration, introductory throat-clearing and digression.

The summarizing is done by the Sakura AI Engine, through your own API token. There is no server belonging to this project: nothing is sent anywhere but the AI Engine, and nothing is collected anywhere at all.

```text
open a page
↓
click the toolbar action
↓
the main content of that page is extracted
↓
it is sent to the Sakura AI Engine with your own token
↓
the summary is shown in the side panel, beside the page
```

- Requirements: [doc/REQUIREMENTS.md](doc/REQUIREMENTS.md)
- Basic design: [doc/BASIC_DESIGN.md](doc/BASIC_DESIGN.md)
- Detailed design: [doc/DETAILED_DESIGN.md](doc/DETAILED_DESIGN.md)

## Features

- **General web pages**: there is no list of supported sites and no site-specific handling; the extraction is one generic strategy
- **Only the page you asked about**: nothing runs until you click, no page is read because it happened to be open, and no run starts on a navigation or on a schedule
- **Substance kept, redundancy dropped**: the central claim, the causal relations that matter, the conclusion and the conditions that qualify it survive the summary
- **No target length**: the length that results from removing the redundancy of a particular page is the length that page gets
- **The Sakura AI Engine does the summarizing**: the extension prepares the material, asks for the summary and displays what comes back
- **Bring your own key**: your own API token is used, and this project holds none and supplies none
- **No backend of its own**: there is no server belonging to this project anywhere in the design
- **Nothing accumulates**: no browsing history, no page text, no summary and no token is stored on a server of this project's, because there is none
- **Read beside the page**: the result appears in Chrome's side panel, so the page it came from stays visible and untouched
- **No build step and no dependency**: the directory you clone is the extension you load

## The pages it is pointed at

Ordinary web pages whose main content is prose. There is no list of supported sites, and none is needed for the extension to be useful: technical articles, blogs and essays, news articles, technical documentation, a GitHub README or issue, product and specification descriptions, FAQs, forum threads and long posts are all pages it is expected to be used on.

**That is not a compatibility list.** It is a description of what kind of page has something to compress. Nor is complete extraction promised: an unusual DOM, content generated after load, a shadow tree, and a page that depends on an authentication state may all leave too little text to work with. That is an ordinary outcome rather than a defect, and it is reported as itself — see [Limitations](#limitations).

## Requirements

- Google Chrome 114 or later. That is the first version with `chrome.sidePanel`, and the manifest states it so that an older browser refuses the extension rather than failing at the first click.
- An environment able to use the Sakura AI Engine, and an API token of your own for it.
- Outbound HTTPS access to `https://api.ai.sakura.ad.jp`, and nothing else.

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

## Preparing the Sakura AI Engine

You need your own Sakura AI Engine API token, and you enter it in the extension's settings. **This project holds no token of its own and supplies none to anybody**, and there is no arrangement under which a page is summarized without a token of yours.

Obtaining a token, and the list of model names the service currently offers, belong to the Sakura AI Engine itself. **Its official documentation is the authority for both**, and this README deliberately does not restate a procedure or a model name that the service owns and can change.

Once you have a token, enter it as described below.

## Configuration

Two settings, and that is the whole of them. Both are held in `chrome.storage.local`, in your own Chrome profile.

| Setting | Required | Default | What it decides |
| --- | :---: | --- | --- |
| API token | yes | — | The Sakura AI Engine credential the request is made with. |
| Model | no | a name recorded in `src/common/settings.js` | Which model the AI Engine summarizes with. |

### First-time setup

After loading and pinning the extension, configure your token:

1. Open `chrome://extensions`.
2. Find **web-digest** and open **Details**.
3. Choose **Extension options** to open the settings page.
4. Enter your own API token in **Sakura AI Engine API token**.
5. To use a different model, enter its name in **Model**. Otherwise, leave it empty
   to use the default.
6. Choose **Save**.
7. Confirm that **Saved.** and **A token is configured.** are shown.

After saving, the token field becomes empty. This is normal: a stored token is never
displayed again. The line **A token is configured.** confirms that it was saved.

The settings page also opens from **Settings** in the side panel's header. When a run
fails because no token is configured, choose **Open settings** in the side panel. Use
either route whenever you need to change the API token or model.

The settings page carries:

- **API token**, a password field. It is **never prefilled**, whatever is stored; a line beside it says whether a token is configured.
- **Model**, a text field, prefilled with the stored value. Leaving it empty means the default.
- **Save**, which validates both fields locally and writes them. A token is refused when it is empty or contains a space or a line break; a model name is refused when it contains a space. **Nothing is checked by contacting the AI Engine** — a token that does not work is discovered by the first run that uses it.
- **Delete token**, which removes the token and leaves the model alone. Saving with an empty token field is refused rather than treated as a deletion, so an accidental save cannot clear a working token.

The endpoint, the timeout, the size budget and the summarization prompt are design constants and resources rather than settings. None of them is something a reader has the information to choose, and each one exposed would be a second decision on a path that is meant to stay at one.

### The token

- **No API token is written into the source code**, and none is committed to this repository, including as a sample value.
- **Your token stays in your own browser profile**, in `chrome.storage.local`, until you delete it.
- It is used as the value of one `Authorization: Bearer` header, to one origin: the Sakura AI Engine.
- **It is never sent to a backend belonging to this project**, because there is none. It reaches no log, no error message, no page and no part of the side panel.

One thing this does not promise: a token held by a browser extension is not a secret kept from the person at the keyboard. Whoever controls the Chrome profile can read extension storage, and no arrangement inside an unpacked extension changes that.

## Usage

After the first-time installation, pinning and token setup, follow these steps for
each page:

1. Open the web page you want summarized.
2. Click the **web-digest** button on the Chrome toolbar.
3. The side panel opens on the right, and the summary run starts automatically from
   that same click.
4. While the run is in progress, the side panel shows **Summarizing… this can take a
   while.**
5. The extension extracts the page's main content and sends it to the Sakura AI
   Engine with your token and configured model.
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
| failed | what went wrong, and what would address it | **Open settings** when no token is configured |

Navigating to another page never starts a run: the panel returns to "nothing run yet" for the new page and waits for the toolbar action. A failed run is never retried automatically. One toolbar click starts one complete run; a long page may require several AI Engine requests within that run.

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

How a summary is written is decided by `prompts/summarize.md`, outside the code. Improving the summaries is editing that file.

## Privacy

- **The content of a page is read only when you have asked for a summary of that page**, at the moment you asked. Nothing of this extension is loaded into a page that was not summarized, and no run reads a tab other than the one it was asked about.
- **No browsing history is collected.** The extension holds no `history` and no `tabs` permission, and the page's URL is never read, never returned by extraction, never stored and never sent.
- **The main content of the page you asked about is sent to the Sakura AI Engine**, together with the summarization instruction, because that is where the summary is produced. This is the point of the extension rather than an incidental transfer, and it is worth knowing before you install it.
- **There is no backend belonging to this project**, so there is nowhere for a page, a summary, a token or a history to be sent to or to accumulate in. That is a property of the design rather than a promise not to look.
- **No page text and no summary is written to disk.** The result of the last run is held in session storage, per tab, and is gone when the browser closes, when the tab closes, or when the tab navigates elsewhere.
- **The token reaches one origin**, as one header, and no other.

The permissions are the smallest set that allows this: `activeTab` for the tab you acted on and no longer, `scripting` to read it once, `storage` for the two settings and the state of the last run, `sidePanel` for the display, and one host permission naming the Sakura AI Engine origin. There is no host permission for any site you visit, so a request to anywhere else is refused by Chrome rather than by this design being obeyed.

## When something fails

Every failure ends the run and shows one message in the panel that names the cause and what would address it: that no token is configured and where to enter one, that the token was refused, that the AI Engine could not be reached or took too long or reported an error, that the content of this page could not be obtained, that this page has too little text, that no usable summary came back.

Causes that lead to different actions stay apart — "no token" and "token refused" are never merged into one message about the API. A message carries no status line, no response body, no internal detail and no API token. What a status code was is recorded in the service worker's console log, which carries counts and durations and never the page's text, its title, its URL, the prompt, the request, the answer or the summary.

For the most common problems:

- **The web-digest button is missing:** Open Chrome's **Extensions** menu, find
  **web-digest**, and pin it to the toolbar.
- **The panel says no API token is configured:** Choose **Open settings**, or open the
  extension's options from `chrome://extensions`, and save your token in
  **Sakura AI Engine API token**.
- **The page cannot be summarized:** Try an ordinary web page. Unusual page
  structures and pages where Chrome does not allow extension scripts — including
  Chrome internal pages — may not be readable.
- **The Sakura AI Engine reports an API error:** Check the API token, model name and
  availability of your Sakura AI Engine account or service.

## Limitations

- **Extracting the main content of every page is not promised.** An unusual DOM, content generated after load, a shadow tree, a page behind an authentication state, and a page built in a way the generic strategy does not recognize may all yield too little text. The run says so rather than summarizing whatever furniture happened to be extractable.
- **Some pages cannot be read at all**: `chrome://` pages, the Chrome Web Store, the PDF viewer and `file://` URLs are refused by Chrome, not by this extension.
- **The summary is produced by a language model.** It is not a guarantee that the meaning of the original survived, and it is no substitute for the page where a judgement actually matters — read the original before deciding anything on it.
- **It reports what the page says.** Whether the page is correct, whether it is worth reading, and whether it was written by a machine are not questions this extension answers.
- **A very long page is summarized in stages.** Material within the conservative 40,000-character request budget uses one request. Longer material is split at heading and block boundaries, each chunk is semantically compressed, and the chunk summaries are integrated into one whole-page summary. Integration is repeated in stages when necessary; content is not sampled or ranked away.
- **A page with too little text is declined too**, for the same reason: there is nothing to compress.
- **Requests are not streamed.** A normal page uses one request; a long page uses the staged requests needed to preserve and integrate its content. The panel says the run is in progress while it waits.
- **The summary is displayed as plain text.** No markup from the page and none from the model is rendered — a decision that removes a class of problem rather than defending against it.
- **The interface is English**, and it is not translated.

## Not built

Deliberately absent from the initial version, and not prepared for anywhere in the design: publication on the Chrome Web Store; official support for Firefox, Safari or Edge; a backend server belonging to this project; user accounts; billing; a shared API token supplied to readers; collecting browsing history; storing summaries in the cloud; summarizing across several pages; web crawling; summarizing on a schedule; retrieval-augmented generation; a vector database; integration with web search; fact checking; judging whether a page is good, correct or machine-generated; translation; a choice of several summarization modes; and a large body of site-specific implementations.

None of these is a gap to be filled later. Should one become necessary, the requirements change first and the design follows.

## Repository structure

```text
.
├── manifest.json               MV3: the permissions, the action, the panel, the options page
├── prompts/
│   └── summarize.md            the summarization instruction, held as data outside the code
├── src/
│   ├── background/             the service worker: one run, start to finish
│   ├── extract/                injected into the tab, once, per request
│   ├── shape/                  blocks in, the material to summarize out
│   ├── engine/                 the only module that speaks to the AI Engine
│   ├── panel/                  the side panel document: the state and the result
│   ├── options/                the settings document: the token and the model
│   └── common/                 the settings accessor, the error kinds, the message names
└── doc/                        the requirements and the designs
```

There is no build step, which is what makes "load unpacked from a clone" the whole of the installation. Four concerns are kept apart — obtaining the content of the page, communicating with the AI Engine, the summarization prompt, and displaying the result — so that changing the model touches the engine client and the settings, and improving the prompt touches one text file that no module reads the contents of.

## Documents

- Requirements: [doc/REQUIREMENTS.md](doc/REQUIREMENTS.md)
- Basic design: [doc/BASIC_DESIGN.md](doc/BASIC_DESIGN.md)
- Detailed design: [doc/DETAILED_DESIGN.md](doc/DETAILED_DESIGN.md)

Each of them stands on its own. What this repository needs is written in this repository, and no document here is completed by one kept somewhere else. Where a document and this README disagree, the documents are right and this README is the one to correct.
