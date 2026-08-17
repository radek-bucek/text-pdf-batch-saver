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
                    runs, e.g. 1500x1300@1. Omit to use the window as it is.
    print_options   JSON passed to Chrome's print-to-PDF. Omit for A4 portrait
                    with no header or footer.
    conflict        What to do when the target file already exists: overwrite
                    (the default), uniquify (add " (1)"), or prompt.

### [context]

Each line is `name = SOURCE` and defines a variable you reference as `{name}` in
any URL, folder, or file template below. The names are yours; a typical setup
names a base URL and the parts of the destination folder:

    base         a URL prefix (the site root) so a task's `*_url`s can be written
                 `{base}/…` and not repeat it.
    mainfolder   the top folder the files are saved into.
    subfolder1   a folder level inside it,
    subfolder2   and further levels as needed - a task's `folder` template joins
                 them into the download path.

The value after `=` says how each variable is filled - one of five sources:

    find REGEX      First match of the regex in web-storage values, then (if
                    none) in the visible page text. For ids kept in app state.
    text REGEX      First match of the regex in the visible page text only (no
                    web storage); capture group 1, or the whole match. For a
                    number shown on the page, like a "3 / 12" counter.
    match REGEX N   The N-th match of the regex in the page HTML; its capture
                    group 1 (or the whole match) is the value. For text in markup.
    url REGEX       The regex run on the current tab URL; capture groups are
                    joined (else the whole match). Use it to derive a base URL -
                    origin + hash root - so task URLs need not repeat the prefix.
    value TEXT      The literal text, exactly as typed.

`/` in a value becomes `–` so it is safe in a folder/file name - **except** `url`
values, which keep their slashes for use inside URL templates. A task stops with a
clear message if a variable resolves to nothing. To pin a fixed value instead of
auto-detecting it, use `value`, e.g. `mainfolder = value My car`.

### [task:NAME]

Every task may carry `hotkey = COMBO`: modifiers (`ctrl`, `alt`, `shift`, `meta`)
joined with `+` and one key (a letter, a digit, or `f1`-`f12`), e.g. `ctrl+shift+s`
or `alt+f2`. At least `ctrl`/`alt`/`meta` is required; each combo is used by one
task only. `type =` picks the flow:

**`type = current-page`** - save the single page currently shown; its parts are
read straight from the URL and page content, with no navigation:

    when     Optional. A source (as in [context]); under detect it decides
             whether this task applies to the shown page.
    <field>  Any key other than type / when / folder / file / hotkey / annotate
             is a field: its value is a source (as in [context]) and becomes a
             {name} placeholder for folder and file.
    annotate Optional. As in document-list: inject a list into the page before
             printing, so cross-references show up in the saved PDF.
    folder   Destination folder template (see Placeholders).
    file     Destination file-name template (see Placeholders).

**`type = document-list`** - read a list from the page, walk each document by URL:

    when            Optional. A source (as in [context]); under detect it decides
                    whether this task applies (else: rows_pattern found rows).
    list_url        URL of the list; the run returns here when finished.
    document_url    URL of one document, with {number} filled in.
    rows_pattern    Regex over the visible page text (flags gm): the named groups
                    (?<number>…) and (?<title>…) mark the document number and its
                    title; one match per row.
    annotate        Optional. SELECTOR @attr field [before SELECTOR] - the one
                    selector-based option: for each matching element read the
                    JSON array in @attr, collect the field values and append
                    " [A, B]" into the page before printing (a regex cannot
                    insert into the DOM).
    folder          Destination folder template (see Placeholders).
    file            Destination file-name template (see Placeholders).

**`type = numbered-pages`** - walk pages counted by a "current / total" counter:

    when             Optional. A source (as in [context]); under detect it decides
                     whether this task applies (else: counter_pattern found a counter).
    page_url         URL of one page, with {index_from0} = the 0-based page number.
    counter_pattern  Regex over the visible page text with named groups: (?<index>…)
                     = current page, (?<total>…) = total; the first match with index
                     <= total wins (so a longer "1345 / 108210" label is skipped).
    folder           Destination folder template (see Placeholders).
    file             Destination file-name template (see Placeholders).

**`type = detect`** - one hotkey that runs whichever listed task fits the shown page:

    tasks    Space-separated task names, tried in order; the first that applies
             runs (in its own mode). A task applies when its when matches; without
             when the built-in signal is used (document-list = rows_pattern finds
             rows, numbered-pages = counter_pattern finds a counter, current-page
             = always).

**`type = capture`** - read fields from the shown page and remember them
persistently, downloading nothing; a later save reuses them as placeholders:

    when     Optional. If present, the capture runs automatically on every page
             that matches (no hotkey needed). A capture needs a hotkey or a when.
    <field>  Any key other than type / when / hotkey is a field: its value is a
             source (as in [context]), remembered under {name} and usable in any
             task's folder / file until re-captured.

### Placeholders

Placeholders for `folder`, `file` and URL templates:

    (context)          any [context] variable - in every task
    (fields)           a current-page task's own fields
    (captured)         values a capture task last remembered
    {number} {title}   document-list: from the matched row
    {index} {total}    document-list / numbered-pages: position and total,
                       zero-padded to max(2, digits(total)) - e.g. 03 and 13
    {index_from0}      numbered-pages URLs: the 0-based page number

Folders in a path are created automatically under Downloads.

## Files

    engine.js            config parsing/validation, page operations, the flows
    background.js        debugger driving, printing, downloads, hotkeys, progress
    offscreen.html/js    turns printed PDFs into downloadable blobs
    popup.html/js        side-panel UI: run buttons, log, Stop, Clear log
    options.html/js      configuration editor with validation
    hotkeys.js           page-side listener for the configured hotkeys
