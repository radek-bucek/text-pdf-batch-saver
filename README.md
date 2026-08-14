# Text PDF Batch Saver (Chrome extension)

Saves application pages as **text PDFs** (real selectable text) into subfolders of
the Downloads folder, triggered by keyboard shortcuts. The extension contains
**only abstract machinery** - task types, waiting/stability heuristics, generic
page operations, printing and downloading. It has no knowledge of any concrete
website: every site-specific thing (variable names, regexes, URL templates,
file-name patterns) lives in a text configuration entered at runtime on the
Configuration page.

## Install

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**
   and pick this folder.
2. **It works right away with no configuration:** **Ctrl+Shift+S** on the page
   saves the shown page as a text PDF **exactly as it is** - no content analysis.
   In the side panel's **Configuration** page, while the configuration is still
   empty, you can set the destination folders (Main folder / Subfolder 1 /
   Subfolder 2); a filled field becomes a subfolder, an empty one is skipped. The
   file name is the page title plus a timestamp.
3. **To customize** (custom hotkeys, single-document mode, other sites): open
   **Configuration** (toolbar icon → side panel), paste your configuration and
   **Validate & save**. Hotkeys are then taken from the
   config (`hotkey = ctrl+shift+s` on a task); the built-in Ctrl+Shift+S applies
   only while the configuration is empty. A hotkey works while a normal web page
   is focused (not on `chrome://` pages or Chrome's own UI).
4. Recommended: in Chrome settings, point the **Downloads location** to your
   archive folder - the tasks then write straight into the archive tree.

> **IMPORTANT:** the Chrome setting **"Ask where to save each file before
> downloading"** must be **OFF** in the profile where you use the extension.
> Chrome gives that setting priority over extensions (`saveAs: false` cannot
> suppress it), so with it enabled a save dialog pops up for every single PDF and
> batch saving is unusable. The setting is per-profile: to keep the prompt for
> your normal browsing, create a dedicated Chrome profile for document
> downloading and turn it off only there (and point that profile's Downloads
> location at the archive folder).

While a task runs, Chrome shows an "is debugging this browser" info bar - that is
how the extension prints to PDF; closing the bar stops the task. Progress lives in
the **side panel**: run buttons, log, Stop and Clear log. The panel stays open
while you work in the page and closes only with its own ✕. Text mode is always
forced before printing (the page CSS filter is removed).

## Configuration format

`key = value` lines; `#` starts a comment line. Three kinds of section:
`[settings]`, `[context]`, and any number of `[task:NAME]` sections (the names
are yours). Values are never quoted - everything after the first `=` is the
value, verbatim.

### [settings]

    viewport        Window-size override "WIDTHxHEIGHT@SCALE" applied while a task
                    runs, e.g. 1510x1300@1.25. Omit to use the window as it is.
    print_options   JSON passed to Chrome's print-to-PDF. Omit for A4 portrait
                    with no header or footer.
    conflict        What to do when the target file already exists: overwrite
                    (the default), uniquify (add " (1)"), or prompt.

### [context]

Each line defines one variable, usable as `{name}` in any template below. The
value is one abstract source:

    find REGEX      First match of the regex in web-storage values, then (if
                    none) in the visible page text. For ids kept in app state.
    match REGEX N   The N-th match of the regex in the page HTML; its capture
                    group 1 (or the whole match) is the value. For text in markup.
    url REGEX       The regex run on the current tab URL; capture groups are
                    joined (else the whole match). Use it to derive a base URL -
                    origin + hash root - so task URLs need not repeat the prefix.
    value TEXT      The literal text, exactly as typed.

A task stops with a clear message if a variable resolves to nothing. `/` in a
value becomes `–` so it is safe in a folder/file name - **except** `url` values,
which keep their slashes for use inside URL templates.

To force a fixed folder instead of auto-detecting it, set its line to a literal,
e.g. `mainfolder = value My car`; leave the `find`/`match` source to auto-detect.

### [task:NAME]

Every task may carry `hotkey = COMBO`: modifiers (`ctrl`, `alt`, `shift`, `meta`)
joined with `+` and one key (a letter, a digit, or `f1`-`f12`), e.g. `ctrl+shift+s`
or `alt+f2`. At least `ctrl`/`alt`/`meta` is required; each combo is used by one
task only. `type =` picks the flow:

**`type = document-list`** - read a list from the page, walk each document by URL:

    list_url        URL of the list; the run returns here when finished.
    document_url    URL of one document, with {number} filled in. It is also
                    matched back against the current URL to read {number} out
                    (used by the current-page task).
    rows_pattern    Regex over the visible page text (flags gm): capture group 1
                    = the document number, group 2 = its title; one match per row.
    document_title  Optional. A source (as in [context]) giving the title on a
                    document page, e.g.  match class="infoPiece"[^>]*>([^<]+)< 1 .
                    Used by the current-page task to name a single file.
    annotate        Optional. SELECTOR @attr field [before SELECTOR] - the one
                    selector-based option: for each matching element read the
                    JSON array in @attr, collect the field values and append
                    " [A, B]" into the page before printing (a regex cannot
                    insert into the DOM).
    folder / file   Destination path templates (see Placeholders).

**`type = numbered-pages`** - walk pages counted by a "current / total" counter:

    page_url         URL of one page, with {index0} = the 0-based page number.
    counter_pattern  Regex over the visible page text: capture group 1 = current
                     page, group 2 = total; the first match with group1 <= group2
                     wins (so a longer "1345 / 108210" label is skipped).
    folder / file    Destination path templates (see Placeholders).

**`type = detect`** - `tasks = name1 name2 …`: probe the listed tasks in order (a
`document-list` matches when its `rows_pattern` finds rows; a `numbered-pages`
when its `counter_pattern` finds a counter) and run the first that matches the
shown page. One hotkey then serves both kinds of tab, downloading it whole.

**`type = current-page`** - `tasks = name1 name2 …`: like `detect`, but saves
only the **one** document / plate currently shown. For a `document-list` it reads
`{number}` from the current URL and the title from `document_title`; for a
`numbered-pages` it reads the counter. Names the file from that task's `file`.

### Placeholders

Any `[context]` variable, plus per flow:

    {number} {title}   document-list: from the row (or from the current page)
    {index} {count}    both flows: position and total, zero-padded to
                       max(2, digits(total)) - e.g. 03 and 13
    {index0}           numbered-pages URLs: the 0-based page number

Folders in a path are created automatically under Downloads.

## Files

    engine.js            config parsing/validation, page operations, the flows
    background.js        debugger driving, printing, downloads, hotkeys, progress
    offscreen.html/js    turns printed PDFs into downloadable blobs
    popup.html/js        side-panel UI: run buttons, log, Stop, Clear log
    options.html/js      configuration editor with validation
    hotkeys.js           page-side listener for the configured hotkeys
