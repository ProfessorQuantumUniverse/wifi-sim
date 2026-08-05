## What this changes

<!-- One or two sentences. What is different after this, and why. -->

## Checks

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes

## If this touches the physics

- [ ] Every new physical constant carries its source in the code next to it
- [ ] Anything used outside its published range is reported rather than hidden
- [ ] There is a test that validates the change against an external reference,
      or asserts an invariant that must hold for any correct implementation

<!--
The bar for a physics test is not coverage. It is one of:
  1. It compares against a standard, a textbook result, a published table or an
     analytic solution.
  2. It asserts an invariant: energy conservation, reciprocity, continuity.
  3. It pins a claim the documentation makes, so the claim cannot go stale.

See docs/reference/validation.md.
-->

## If this changes what the user sees

- [ ] The documentation under `docs/` is updated to match
- [ ] No em dashes in any prose, comment or interface string

## Licence

By opening this pull request you agree your contribution is licensed under the
GNU General Public License v3.0 or later, the same as the rest of the project.
