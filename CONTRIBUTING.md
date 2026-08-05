# Contributing

The full version of this lives in the documentation:
**<https://professorquantumuniverse.github.io/wifi-sim/docs/reference/contributing>**

The short version.

## The most useful contribution needs no code

**Material data with a citation.**

The material library is limited to ITU-R P.2040 Table 3, because that is the only
source this project has for building materials and it does not invent numbers.
Missing entirely: PVC window profiles, screed, tile, carpet, mineral wool, rigid
insulation board, aerated concrete blocks.

If you have a permittivity and conductivity for any of those, with a source, that
single contribution improves every result the tool produces for anybody with that
material in their building. There is
[an issue template for it](https://github.com/ProfessorQuantumUniverse/wifi-sim/issues/new/choose).

Almost as useful: a floorplan the tracer handles badly, and a comparison between
a map this produced and a real measurement.

## Code

```bash
git clone https://github.com/ProfessorQuantumUniverse/wifi-sim.git
cd wifi-sim
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

Open an issue first for anything beyond a small fix.

### Use npm 11

The lock file is resolved with **npm 11**, and CI pins the same major. npm 10
and npm 11 disagree about a conflicting optional peer dependency deep in the
VitePress tree, so a lock file regenerated with npm 10 will fail `npm ci` on
npm 11 and the other way round.

If you change dependencies, check your version with `npm --version` and upgrade
with `npm install -g npm@11` before committing a new `package-lock.json`.

## The rules that are not negotiable

**No invented numbers.** Every physical constant needs a source in the code next
to it, and the app has to be able to state that source.

**A model used outside its range says so.** Returning a confident wrong answer is
the specific failure this project exists to avoid.

**Physics changes come with a validating test.** Not a test that a function
returns what it returns. A test against an external reference, or an invariant
that must hold for any correct implementation. See
[the validation suite](https://professorquantumuniverse.github.io/wifi-sim/docs/reference/validation).

**No em dashes in prose.** House style.

## Style

Match the surrounding code. Comments explain why, not what. Physics files carry
the reference they implement at the top. British spellings in identifiers and
prose, since that is what the codebase already uses: `polarisation`,
`unpolarised`, `serialise`, `colour`.

## Licence

This project is under the **GNU General Public License v3.0 or later**. By
contributing you agree your contribution is licensed under the same terms.
