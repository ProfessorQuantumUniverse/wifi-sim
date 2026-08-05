import { defineConfig } from 'vitepress'

/**
 * The docs are served from a subdirectory of the Pages site, next to the app
 * itself. `DOCS_BASE_PATH` is set by the deploy workflow; running the docs
 * locally needs no prefix at all.
 */
export default defineConfig({
  title: 'WiFi-Sim',
  description: 'A physically-based Wi-Fi planner that runs in your browser',
  base: process.env.DOCS_BASE_PATH ?? '/',
  lang: 'en-GB',
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: 'Start here', link: '/guide/getting-started' },
      { text: 'Using it', link: '/guide/floorplan' },
      { text: 'The physics', link: '/physics/' },
      { text: 'Reference', link: '/reference/file-format' },
      {
        text: 'Open the app',
        link: 'https://professorquantumuniverse.github.io/wifi-sim/',
      },
    ],

    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'What this is', link: '/' },
          { text: 'Your first coverage map', link: '/guide/getting-started' },
          { text: 'Ways to run it', link: '/guide/install' },
        ],
      },
      {
        text: 'Using it',
        items: [
          { text: '1. Load and trace a floorplan', link: '/guide/floorplan' },
          { text: '2. Set the scale', link: '/guide/scale' },
          { text: '3. Build the model', link: '/guide/model' },
          { text: '4. Set up the radio', link: '/guide/radio' },
          { text: '5. Compute and read the map', link: '/guide/results' },
          { text: 'Going further', link: '/guide/planning' },
          { text: 'Saving and sharing work', link: '/guide/saving' },
          { text: 'When something looks wrong', link: '/guide/troubleshooting' },
        ],
      },
      {
        text: 'The physics',
        items: [
          { text: 'Overview', link: '/physics/' },
          { text: 'Materials', link: '/physics/materials' },
          { text: 'Walls and glazing', link: '/physics/walls' },
          { text: 'Finding the paths', link: '/physics/tracing' },
          { text: 'From signal to speed', link: '/physics/rates' },
          { text: 'What this does not model', link: '/physics/limits' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Project file format', link: '/reference/file-format' },
          { text: 'Validation suite', link: '/reference/validation' },
          { text: 'Architecture', link: '/reference/architecture' },
          { text: 'Contributing', link: '/reference/contributing' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ProfessorQuantumUniverse/wifi-sim' },
    ],

    search: { provider: 'local' },

    editLink: {
      pattern:
        'https://github.com/ProfessorQuantumUniverse/wifi-sim/edit/main/docs/:path',
      text: 'Improve this page on GitHub',
    },

    footer: {
      message:
        'Released under the GNU General Public License v3.0 or later. Physical constants are cited to their sources, not invented.',
      copyright: 'Copyright (C) 2025 Lorenzo Bay-Mueller',
    },
  },
})
