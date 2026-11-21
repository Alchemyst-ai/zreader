# zreader

A reader for long-form books on the web: chapters compiled from Markdown/MDX, read in the browser, with reader data (highlights, notes, scratchpads) kept in the reader's own browser.

## Running code

**RunnableCode**:
Code in a scratchpad or chapter that a Sandbox can run on request, shown with its Output.
_Avoid_: cell, code cell, runnable block, snippet

**Sandbox**:
The thing that runs RunnableCode, either in the reader's browser or on the site's server.
_Avoid_: agent sandbox, runner, executor

**Kernel**:
One live interpreter for one language that holds the state of one pad or one chapter page, in one browser tab.
_Avoid_: session, runtime, process

**Output**:
What the last run of a piece of RunnableCode produced; stale once the code changes.
_Avoid_: result, cell output

**codeSource**:
Who wrote a piece of RunnableCode: `scratchpad` (the reader) or `chapter` (the book's author). It decides which permissions apply.
_Avoid_: trust scope, scope, origin

**Dangerous permissions**:
Abilities a Sandbox does not have unless the site owner grants them in config, such as network access and installing packages.
_Avoid_: capabilities, privileges
