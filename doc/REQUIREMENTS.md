# Requirements: a summarizer for the page in front of the reader

## 1. Purpose of this document

This document states what `web-digest` is for, what it accepts, what it produces
and where its responsibility ends. It states requirements and the reasons behind
them, and deliberately holds no module name, no function name and no extraction
algorithm.

How those requirements are met — the composition of the extension, what runs in
which context, the shape of a request to the summarization endpoint, the wording
of the prompt — belongs to a basic design document, which does not exist yet.
Section 21 records what the documents of this repository are meant to be and
what of that is still outstanding.

It stands on its own. Nothing in it is completed by a document in another
repository.

## 2. Name

`web-digest`. The name is the output, not the technique: the extension exists to
produce a digest of a web page, and the content extraction, the language model
and the browser integration are how one is produced.

The name commits to no particular site, no particular kind of article and no
particular model.

## 3. Purpose

**web-digest takes the page the reader currently has open, extracts its main
content, and produces a short summary that keeps the substance of the page.**

It exists to make a long page usable before it has been read in full. What it is
required to deliver:

- the central content of a long text, extracted,
- a summary that preserves the substance rather than merely cutting the length,
- several examples and repeated explanations of one claim, compressed into it,
- the information that matters for the kind of page it is, kept,
- the whole of that run from the browser, on the page being read,
- through the reader's own Sakura AI Engine environment.

**The primary requirement is semantic compression, not shortening.** A summary
that is short and has lost the condition the claim depends on has failed, and a
summary that is longer than expected because the page carried little redundancy
has not.

## 4. The problem

Summarizing to a length and summarizing to a substance are different jobs, and
what makes a long page hard to summarize well is that the two come apart.

- **What is easiest to cut is often what carries the argument.** A condition, a
  reservation, a step in a causal chain and an exception are all short, and a
  reduction that works on length removes them before it removes a paragraph of
  rhetoric.
- **What is longest is often the least informative.** A single proposition
  supported by four examples, a restatement, an introduction that says what is
  about to be said — these are where the volume is, and removing them costs the
  reader nothing.
- **A fixed length distorts every page it is applied to.** A page with little
  redundancy is mutilated to reach the target, and a padded page is left padded
  because the target was met.
- **What matters is not the same on every page.** The conclusion of an essay,
  the constraints of a specification and the unresolved point of a discussion
  are each the thing a reader came for, and a summary that treats all three the
  same way loses one of them.

The requirements in sections 11 and 12 follow from this: what is kept is stated
in terms of the content, and what is removed is stated in terms of redundancy.

## 5. What it is not

- **Not a reader or an archive.** It summarizes the page in front of the reader,
  on request, and keeps no collection.
- **Not a crawler.** It follows no link, visits no page of its own accord and
  reads nothing the reader has not opened.
- **Not a fact checker.** It reports what the page says. Whether the page is
  correct, whether it is worth reading, and whether it was written by a machine
  are not questions this project answers.
- **Not a translator.** Rendering a page into another language, as a job in
  itself, is different from compressing it. Choosing the language the summary
  itself is written in is not that job.
- **Not a hosted service.** There is no server belonging to this project, no
  account, and no shared credential.

## 6. Who uses it

One reader, who is also the holder of the API token and the person who installed
the extension. There are no accounts, no roles and no data shared between
several people.

The use it is built for is personal reading of long pages: technical articles,
essays, news, documentation and the like, read one at a time in a browser.

## 7. Where it runs, and how it is obtained

A Chrome extension, running in Google Chrome.

**The initial version is not published on the Chrome Web Store.** It is obtained
from this GitHub repository and loaded through Chrome's developer mode, as an
unpacked extension. No requirement, no artifact and no constraint exists in this
document for the sake of a store review, and none is to be added on the
assumption that publication is coming.

Firefox, Safari and Edge are not supported in the initial version. Nothing here
requires the implementation to be hostile to them; it simply does not promise
them.

Because the extension is taken straight from a repository rather than from a
store, **what a reader needs in order to install and configure it has to be
written down in this repository.** That obligation falls on the README, and
section 21.1 states what it must carry.

## 8. What it is pointed at

General web pages. There is no list of supported sites, and no site-specific
implementation is required in order for the extension to be useful.

The pages it is expected to be used on include technical articles, blogs and
essays, news articles, technical documentation, a GitHub README or issue,
product and specification descriptions, FAQs, forum threads and long posts, and
other pages whose main content is prose.

**Extracting the main content of every page is not promised.** An unusual DOM,
content generated after load, Shadow DOM, a page that depends on an
authentication state, and a site-specific implementation may all leave too
little text to work with. **That is an ordinary outcome, not a defect**, and
what the reader is owed in that case is a clear statement that it happened — see
section 18.

## 9. Running a summary

**A summary runs only when the reader asks for one.** The extension does not
collect pages in the background, does not summarize a page the reader has not
asked about, and does not act on a schedule.

One run is this sequence:

1. the reader opens a web page,
2. the reader asks for a summary from the extension,
3. the extension extracts the main content of the page,
4. the content is sent to the Sakura AI Engine,
5. the AI Engine produces a summary that keeps the substance,
6. the reader reads the result in Chrome.

**What the reader has to know how to do is one thing: summarize this page.**
Selecting a mode, choosing a length, picking a model or preparing a prompt is
not part of ordinary use, and a design that adds a second decision to the main
path is answering a requirement that has not been stated.

## 10. What is taken from the page

The text that carries the content of the page. As far as the page allows, that
includes:

- the title,
- the headings,
- the body text,
- lists,
- the significant text in tables,
- any other text needed to understand what the page says.

What is excluded, as far as it can be recognized:

- navigation,
- advertising,
- menus,
- footers,
- material common to every page of the site,
- other obvious interface furniture.

**How the extraction is performed is a design question and is not settled here.**
No algorithm, no library and no heuristic is named in this document. What is
required of it is stated above in terms of what ends up in the material, and in
section 8 in terms of what happens when it does not.

## 11. What the summary keeps

The summary keeps what the kind of page makes essential.

For an essay or an article:

- the central claim,
- the main grounds for it,
- the causal relations that matter,
- the conclusion,
- the conditions and reservations that could change that conclusion.

For an explanatory text or technical documentation:

- the purpose,
- the main mechanism,
- the significant parts of the specification,
- the conditions under which it is used,
- the constraints.

For an issue or a discussion:

- the problem,
- the main points at issue,
- the material on which a judgement would rest,
- the conclusion as it currently stands,
- what remains unresolved.

**These are not modes the reader selects.** They describe what a good summary of
such a page contains, so that the requirement is stated in terms of content
rather than in terms of a switch. A page that is a mixture is summarized as the
mixture it is.

## 12. Semantic compression

What is reduced, where it is not itself the substance:

- repetition of the same content,
- several examples illustrating one proposition,
- rhetorical elaboration,
- introductory throat-clearing,
- digression,
- redundant restatement,
- supporting explanation that does not bear on the main line.

**A character count is not the primary constraint.** The summary is not trimmed
mechanically to a target length. The measure is that the redundancy is gone and
the substance is intact, and the length that results from applying that measure
to a particular page is the right length for that page.

Two consequences are intended and are not to be treated as faults: a dense page
compresses less than a padded one, and two pages of the same original length do
not produce summaries of the same length.

## 13. Showing the result

The summary is shown where the reader can read it without leaving the page it
came from, and reading it is the whole of what is required.

**The initial version needs no more than a result that can be read easily.**
Several display modes, a comparison view, an analysis screen, an export format
and a stored list of past summaries are not required, and none of them is to be
added in order to make the result look more substantial than it is.

## 14. The Sakura AI Engine

The summarization is performed by the Sakura AI Engine (さくらの AI Engine). The
extension prepares the material, asks for the summary and displays what comes
back; the inference happens at the endpoint.

- **The reader's own API token is used — bring your own key.** This project holds
  no token of its own and supplies none to anybody.
- **A shared token operated on the readers' behalf is not a fallback and not a
  future convenience.** There is no arrangement in this design under which a
  reader summarizes a page without a token of their own.
- **The model is a setting, not a fixture.** No requirement in this document
  depends on a particular model, and changing which model is used must not
  require the requirements to be rewritten.

## 15. The API token

The reader can configure their own Sakura AI Engine API token, and that is the
only way a token reaches the extension.

These lines are not crossed:

- **No API token is written into the source code.**
- **No API token is committed to this repository**, including as a sample value.
- **No API token is embedded in anything distributed.**
- **A reader's token is held within their own browser environment**, and is the
  concern of that environment alone.
- **No token is sent to, or stored on, a server belonging to this project.**

A token is not displayed where it does not have to be, and does not appear in a
message shown to the reader.

## 16. Privacy

**The content of a page is read only when the reader has asked for a summary of
that page.** No other reading of a page is performed, and no page is read
because it happened to be open.

What is extracted is sent to the Sakura AI Engine, to the extent the summary
requires, and to nowhere else.

A server belonging to this project collects and stores none of the following:

- browsing history,
- the text of a page,
- a summary,
- an API token.

**The initial version has no backend of its own at all**, so there is no place
in this design where any of that could accumulate. That is the reason the list
above holds, and it is stronger than a promise not to look.

## 17. The state of a run

The reader can tell which of these a run is in:

- in progress,
- succeeded,
- failed.

A run whose outcome cannot be told apart from a run that has not started is a
defect, however the interface is built.

## 18. Errors

The reader is told when any of these happens, in terms they can act on:

- no API token has been configured,
- the API rejected the credential,
- the API could not be reached,
- the content of the page could not be obtained,
- there is not enough text on the page to summarize,
- the AI Engine returned an error,
- the content is larger than can be processed.

**These are distinguished from each other**, because what the reader does next
differs: configure a token, replace a token, retry later, accept that this page
cannot be extracted, or summarize a smaller page. One message covering all of
them leaves them guessing.

An error message carries no API token and no internal detail that the reader has
no use for.

## 19. Maintainability

Four concerns exist in this system, and **none of them is bound more tightly to
another than it has to be**:

- obtaining the content of the page,
- communicating with the AI Engine,
- the summarization prompt,
- displaying the result.

What this buys is the two changes that are certain to be wanted: **changing the
model, and improving the prompt.** Neither may require the extraction or the
display to be rewritten, and improving how a page is extracted may not require
the prompt to be revisited.

**The module composition, the file layout and the interfaces between these
concerns are settled in the basic design, not here.** This document requires the
separation and fixes no implementation of it.

## 20. Simplicity

The initial version does one thing: it summarizes the page in front of the
reader.

A feature whose necessity has not been demonstrated is not added in advance of
it. The main path is completed in as few steps as it can be, and a change that
adds a step to that path is weighed against the whole purpose of the extension
rather than judged on its own merits.

## 21. The documents

The intended layout of the repository's documents:

```text
README.md

doc/
└── REQUIREMENTS.md
```

`README.md` is the entrance, and `doc/` holds the detail. Everything named below
as outstanding is future work, and is not created by the change that adds this
document.

### 21.1 The README

Because the extension is installed from this repository rather than from a
store, the README is the only instruction a reader gets. It has to make at least
these clear:

- what the project is,
- its main features,
- how it is installed,
- what is needed in order to use the Sakura AI Engine,
- how the API token is configured,
- how it is used,
- the main limitations.

**The README does not yet carry these, and bringing it up to that is outstanding
work.** It is recorded here so that it is not lost, and it is deliberately not
done by the change that adds this document.

### 21.2 The basic design

There is no basic design document yet. The composition of the extension, the
extraction approach, the request to the endpoint, the handling of settings and
the wording of the prompt belong there, and writing it is outstanding work.

Where a subject is missing from this document, it is a gap to be filled here,
not something to be looked up in another repository. Where a subject belongs to
the design, this document leaves it open on purpose rather than settling it
early.

## 22. Independence

This repository is understood, developed and used on its own.

The documentary conventions of other repositories by the same author — where a
requirements document lives, how it is laid out, what it settles and what it
leaves to the design — were followed deliberately. **Nothing else was taken from
them.** No requirement, no explanation and no design decision in this document
comes from another project, and no document here is completed by one.

## 23. Out of scope for the initial version

- publication on the Chrome Web Store,
- official support for Firefox, Safari or Edge,
- a backend server belonging to this project,
- user accounts,
- billing,
- a shared API token supplied to readers,
- collecting browsing history,
- storing summaries in the cloud,
- summarizing across several pages,
- web crawling,
- summarizing on a schedule,
- retrieval-augmented generation,
- a vector database,
- integration with web search,
- fact checking the content of a page,
- automatically judging whether a page is good, correct or worth reading,
- judging whether a page is machine-generated slop,
- a standalone translator, as distinct from the summary's own output language,
- a choice of several summarization modes,
- a large body of site-specific implementations.

None of these is to be added to the requirements on anybody's own judgement.

## 24. Acceptance conditions

The initial version has met its purpose when all of the following hold:

1. The extension can be loaded into Chrome from this repository as an unpacked
   extension.
2. A reader can configure their own Sakura AI Engine API token.
3. A summary can be run on an ordinary web page, from the page itself.
4. A summary runs only when the reader asks for one, and no page is read or
   summarized in the background.
5. The main text of the page is obtained, with the obvious interface furniture
   left out as far as it can be recognized.
6. What was obtained is sent to the Sakura AI Engine.
7. What comes back is a concise summary that keeps the substance of the page
   rather than one cut to a length.
8. The result can be read in Chrome.
9. A run in progress, a run that succeeded and a run that failed are told apart.
10. Each of the errors in section 18 is reported to the reader, distinguishably.
11. No API token is present anywhere in this repository or in anything
    distributed from it.
12. Nothing in the design requires a backend server belonging to this project.
13. What a reader needs in order to obtain, install, configure and use the
    extension from GitHub is written down in this repository.
