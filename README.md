# WiFi-Sim

A free, offline Wi-Fi planning suite that runs in your browser. Upload a photo or scan of your floorplan, trace the walls, describe what they are made of, place your router, and get a coverage map computed from actual electromagnetics.

Nothing is uploaded anywhere. It all runs locally.

## What it actually computes

Every path from the router to every point on the map is enumerated and solved in closed form: the direct path, specular reflections up to second order, transmission through each wall in between, and UTD edge diffraction around corners and through door reveals. Walls are not "6 dB per wall" lookups. Each build-up is solved with the exact multilayer transfer matrix, per polarisation and incidence angle, from ITU-R P.2040 material data. Rates come from the IEEE 802.11 sensitivity tables and OFDM numerology, not from a rate chart.

Validated against analytic references: free space to 0.002 dB, two-ray ground reflection to 0.06 dB, Brewster null exact, energy conserved to 1e-9.

## Why bother

Free Wi-Fi planners are empirical. They add up a fixed dB per wall along the line of sight, which means they cannot represent reflection, diffraction, interference, or the fact that the same wall behaves differently at 2.4 and 5 GHz. Their heatmaps look convincing and are mostly decoration. The tools that do real physics (Ekahau, iBwave, Ranplan) are closed and expensive.

Two examples of what the difference costs you:

* A 4-16-4 insulating glass unit attenuates 0.2 dB at 2.4 GHz and 9.3 dB at 5.5 GHz. Same window, 9 dB apart, because at 5.5 GHz the cavity is near half a wavelength. No per-wall table can express that.
* Add the Low-E coating that every window fitted since about 2000 has, and it becomes 29 dB at 2.4 GHz and 34 dB at 5.5 GHz. That single fact explains most "why is my Wi-Fi dead on the balcony" mysteries, and most tools ignore it entirely.

The other principle: no invented numbers. Every physical constant carries its source, and the app says so. Anything not covered by a standard is a required input with a stated valid range, never a silent default. Where a model is used outside its validity (rebar mesh at Wi-Fi wavelengths, for instance), it says that too instead of returning a confident wrong answer.

## How to use it

```bash
npm install
npm run dev
```

The sidebar shows five steps and marks which one you are on.

**1. Load the floorplan.** Any image. Drag it onto the canvas or use the button.

**2. Trace the walls.** Adjust sliders until only the walls are highlighted red. The important one is "Min stroke half-width", which deletes everything thinner than the wall strokes: dimension lines, hatching, text. Use the ROI and Exclude tools for title blocks and detail drawings. Then press **Trace walls**. Sliders only change the mask, tracing is a separate step.

**3. Set the scale.** Click **Pick two points**, click both ends of a dimension printed on the plan, type its length in metres. Required, since everything downstream is in metres.

**4. Build the model.** Press **Build model** in the header. Check the wall build-ups (thickness is measured off your drawing and matched automatically), add windows and doors, set the ceiling height. The inspector plots what each build-up does across frequency and incidence angle, so you can sanity check a wall before trusting the map.

**5. Place a router and compute.** Set band, channel, width, power, antenna type and how it is mounted (on a shelf, inside a cabinet, ceiling mounted). Set what you are measuring coverage *for*, since a phone in your hand sees a different map from a laptop on a desk. Press **Compute coverage**.

Then: probe any point to see the dominant ray paths drawn on the plan, add neighbouring networks and rank channels against them, let the optimiser search for a better router position, and export an HTML report with every setting and source.

### Two things worth knowing

* **Look up your router with AI.** In the radio panel there is a button that writes a research brief for your exact model and reads back the JSON. It reconciles conducted power against EIRP and your regulatory ceiling, and tells you afterwards exactly which fields it took and which are still your own values.
* **Your work is saved automatically** in the browser. Use Save and Open for `.wifisim` files if you want a backup or want to move a project to another machine.

## Stack

TypeScript, React, Vite, Zustand. No runtime dependencies beyond that, no network calls, no build step needed to read the physics: it lives in `src/physics` and `src/engine`.

License: See the LICENSE file.
