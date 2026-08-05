#!/usr/bin/env node
/*
 * WiFi-Sim launcher.
 * Copyright (C) 2025 Lorenzo Bay-Mueller
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. See <https://www.gnu.org/licenses/> for details.
 */

/*
 * Serves the built app on localhost and opens a browser at it.
 *
 * This exists because the app needs an HTTP origin. It uses Web Workers for
 * the wall tracing and the coverage solve, and browsers refuse to start a
 * worker on a page opened from the file system, so simply double-clicking an
 * index.html would give you an app where the two slowest buttons do nothing.
 * A local server is the smallest thing that makes it work.
 *
 * No dependencies on purpose: `npx wifi-sim` should download the app and
 * nothing else, and it should keep working years from now.
 */

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
}

function parseArgs(argv) {
  const options = { port: 4173, host: '127.0.0.1', open: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '-p') options.port = Number(argv[++i])
    else if (arg === '--host') options.host = argv[++i]
    else if (arg === '--no-open') options.open = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
  }
  return options
}

function printHelp() {
  process.stdout.write(
    [
      '',
      '  WiFi-Sim, a physically-based Wi-Fi planner that runs in your browser.',
      '',
      '  Usage:  npx wifi-sim [options]',
      '',
      '    -p, --port <n>   Port to listen on (default 4173)',
      '        --host <h>   Address to bind (default 127.0.0.1, this machine only)',
      '        --no-open    Do not open a browser window',
      '    -h, --help       Show this message',
      '    -v, --version    Show the version',
      '',
      '  Everything runs locally. Nothing you load is uploaded anywhere.',
      '',
      '',
    ].join('\n'),
  )
}

/** Resolve a URL path to a file inside ROOT, or null if it escapes it. */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const candidate = normalize(join(ROOT, decoded))
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // Not being able to open a browser is not a reason to fail; the URL is
    // printed either way.
  }
}

const options = parseArgs(process.argv.slice(2))

if (options.help) {
  printHelp()
  process.exit(0)
}

if (options.version) {
  const pkg = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ),
  )
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}

if (!existsSync(join(ROOT, 'index.html'))) {
  process.stderr.write(
    'The built app is missing from this package. If you are running from a clone, run "npm run build" first.\n',
  )
  process.exit(1)
}

const server = createServer((request, response) => {
  const file = resolveFile(request.url ?? '/') ?? join(ROOT, 'index.html')
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'

  response.setHeader('Content-Type', type)
  // The app is a single-page bundle with content-hashed asset names, so the
  // entry document must never be cached while everything else safely can be.
  response.setHeader(
    'Cache-Control',
    file.endsWith('index.html') ? 'no-cache' : 'public, max-age=604800',
  )
  createReadStream(file)
    .on('error', () => {
      response.statusCode = 500
      response.end('Could not read that file.')
    })
    .pipe(response)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(
      `Port ${options.port} is already in use. Try: npx wifi-sim --port ${options.port + 1}\n`,
    )
    process.exit(1)
  }
  throw error
})

server.listen(options.port, options.host, () => {
  const url = `http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${options.port}/`
  process.stdout.write(`\n  WiFi-Sim is running at ${url}\n  Press Ctrl+C to stop.\n\n`)
  if (options.open) openBrowser(url)
})
