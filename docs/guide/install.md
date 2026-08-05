# Ways to run it

There is no wrong choice here. They all run the identical application, and in
every case the computation happens on your own machine and nothing you load is
sent anywhere.

## In a browser, nothing to install

<https://professorquantumuniverse.github.io/wifi-sim/>

This is the right answer for almost everyone. The page loads once and then
everything, the wall tracing and the coverage solve included, runs locally in
your browser.

"Hosted" here only means the program itself is downloaded from GitHub, the same
way any web page is. Your floorplan is never uploaded, because there is nothing
on the other end to upload it to.

## Locally, one command

```bash
npx wifi-sim@latest
```

This downloads the built app, starts a small web server on your own machine and
opens a browser at it. It needs [Node.js](https://nodejs.org) 18 or newer and
nothing else. Press Ctrl+C to stop it.

Options:

```bash
npx wifi-sim --port 8080     # listen somewhere else
npx wifi-sim --no-open       # do not open a browser
npx wifi-sim --host 0.0.0.0  # reachable from other machines on your network
```

By default it binds to `127.0.0.1`, so only your own machine can reach it.

To update, run the same command again. The `@latest` is what makes npm fetch a
new version rather than reuse the one it cached.

## In a container

```bash
docker run --rm -p 8080:8080 ghcr.io/professorquantumuniverse/wifi-sim:latest
```

Then open `http://localhost:8080`. No Node, no toolchain, and once the image is
pulled it works with no internet connection at all. This is the easiest option
on a locked-down work machine or a home server.

## On your own web server

Every [release](https://github.com/ProfessorQuantumUniverse/wifi-sim/releases)
has a `wifi-sim-dist.zip` attached. Unpack it into any directory your web server
serves and you are done. It is plain static files, no server side, no database,
no configuration.

## From source

Only worth it if you want to change something.

```bash
git clone https://github.com/ProfessorQuantumUniverse/wifi-sim.git
cd wifi-sim
npm install
npm run dev
```

See [architecture](/reference/architecture) for what lives where, and
[contributing](/reference/contributing) before you send a change.

## Why there is no double-clickable HTML file

It would be the nicest option and it does not work. The wall tracing and the
coverage solve both run in Web Workers, so they do not freeze the interface
while they think, and browsers refuse to start a worker on a page opened from
the file system. A single HTML file would open, look completely normal, and then
do nothing when you pressed either of the two buttons that matter.

Anything on this page that runs locally therefore starts a small local web
server. That is the whole reason `npx wifi-sim` exists rather than a download.
