# Contributing

Contributions are welcome. The most valuable one is probably not code.

## The most useful thing you can give this project

**Material data with a citation.**

The material library is limited to ITU-R P.2040 Table 3, because that is the only
source this project has for building materials and it does not invent numbers.
That leaves real gaps. Missing entirely:

- PVC and uPVC window profiles
- Screed, floor tile, carpet
- Mineral wool and other cavity insulation
- EPS and other rigid insulation boards
- Aerated concrete blocks
- Modern composite panel systems

If you have a permittivity and conductivity for any of these, with a source, that
single contribution improves every result the tool produces for anybody with that
material in their building.

What is needed:

- The material and, if it varies, which product or grade
- Relative permittivity and conductivity, or the P.2040-style `a`, `b`, `c`, `d`
  power law coefficients
- The frequency range the values were measured or published over
- **The source.** A paper, a standard, a manufacturer's data sheet, or your own
  measurement with the method described.

Open a
[material data issue](https://github.com/ProfessorQuantumUniverse/wifi-sim/issues/new/choose).
You do not need to write any code. Somebody will.

## The second most useful thing

**A floorplan the tracer handles badly.**

The tracing step is where people give up, and the defaults can only get better
against real drawings. If you have a plan that fights back, open a
[tracing issue](https://github.com/ProfessorQuantumUniverse/wifi-sim/issues/new/choose)
and attach the image, plus what you tried.

Only attach a plan you are willing to have public. If you cannot share the real
one, a redrawn version with the same character is still useful.

## The third: a measurement

If you have measured your own network and compared it against a map this tool
produced, that comparison is worth having, whether it agreed or not. Disagreements
are more useful than agreements.

## Code

### Before you start

Open an issue first for anything beyond a small fix. It saves you building
something that turns out to conflict with a design decision that is not written
down yet.

### Getting set up

```bash
git clone https://github.com/ProfessorQuantumUniverse/wifi-sim.git
cd wifi-sim
npm install
npm run dev
```

Read [architecture](/reference/architecture) for what lives where.

### Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

All three run in CI, so getting them right first saves a round trip.

### The rules that are not negotiable

**No invented numbers.** Every physical constant needs a source that goes in the
code next to it, and the app has to be able to state that source. If a standard
does not cover something, it becomes a required input with a stated valid range,
not a silent default.

**A model used outside its range says so.** When something is extrapolated or a
model does not apply, the code reports it and the report surfaces it. Returning a
confident wrong answer is the specific failure this project exists to avoid.

**Physics changes come with a validating test.** Not a test that the function
returns what it returns. A test against an external reference, or an invariant
that must hold for any correct implementation. See
[the validation suite](/reference/validation) for the bar and for three real
bugs that bar has caught.

**No em dashes in prose.** House style.

### Style

Match the surrounding code. It is consistent, it is commented, and the comments
explain *why* rather than restating *what*. Physics files carry the reference
they implement at the top, with author, publication and equation numbers.

British spellings in identifiers and prose, since that is what the codebase uses
already: `polarisation`, `unpolarised`, `serialise`, `colour`.

## Licence

This project is under the **GNU General Public License v3.0 or later**.

By contributing you agree your contribution is licensed under the same terms.

In practice that means anybody may use, study, modify and redistribute this, and
anybody who distributes a modified version must make their source available under
the same licence. That was a deliberate choice: the physics engine is the
valuable part, and it should stay free for everybody rather than become the basis
of somebody's closed product.

## Reporting a security issue

There is no server, no account and no data leaves the browser, which removes most
of the usual attack surface. If you do find something, please open a
[security advisory](https://github.com/ProfessorQuantumUniverse/wifi-sim/security/advisories/new)
rather than a public issue.

## Code of conduct

Be decent. Assume the other person is trying to help. Disagree about the physics
as much as you like, with sources.
