# Saving and sharing work

## Autosave

Your work is saved automatically in the browser as you go, in IndexedDB. Close
the tab and come back and it will still be there.

Two things to be aware of:

- It is **per browser and per machine**. A project saved in Firefox on your
  laptop is not visible in Chrome, or on your phone.
- Clearing site data clears it. Some privacy settings and some "clear history on
  exit" configurations will do this without asking.

So autosave is a convenience, not a backup. If a project matters, export it.

## Project files

**Save** writes a `.wifisim` file. **Open** reads one back.

Use it to:

- Keep a backup of a project that took real effort to trace.
- Move a project between machines or browsers.
- Keep variants side by side, so you can compare "router in the hall" against
  "router in the living room" without redoing the model.
- Send a model to somebody else to look at.

The file contains everything: the floorplan image, the tracing settings, the
traced walls, the scale, the full model, your custom materials, and every radio
and client setting.

It is plain JSON, so you can read it in a text editor, keep it in version
control, and diff two variants. The format is documented in
[project file format](/reference/file-format).

::: tip The heatmap is not in the file
Deliberately. It can be several megabytes, and it goes stale the instant any
setting changes. Press **Compute coverage** after opening a project and you get
it back in a few seconds.
:::

## What to send somebody else

**A report** if they just need the answer. It is one self-contained HTML file
that opens in any browser with no software and no internet.

**A `.wifisim` file** if they need to change something, try a different router
position, or check your assumptions.

## Privacy

Nothing about your project leaves your machine at any point. There is no account,
no server, no telemetry and no network call in the application.

The one thing worth pausing over is the AI router lookup. It writes a research
brief for you to take to an AI assistant. If you use it, what you paste into that
assistant goes to whoever operates it, subject to their terms. That is a
deliberate design choice rather than a limitation: the app does not talk to
anybody so that you decide what gets shared.

A `.wifisim` file, on the other hand, contains your floorplan image. Think about
that before you email one.
