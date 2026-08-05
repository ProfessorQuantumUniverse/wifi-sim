# 2. Set the scale

The shortest step and the one with the worst failure mode.

## What to do

1. Press **Pick two points**.
2. Click both ends of something on the plan whose real length you know.
3. Type that length in metres.

That is all.

## Why it matters more than it looks

Everything downstream of this point is in metres. Path lengths, wall thicknesses,
where a reflection lands, whether a wall cavity is a half wavelength across, and
the free-space spreading that dominates the whole result.

Getting the scale wrong does not make the app fail. It makes it produce a map
that is entirely self-consistent, looks completely normal, and is wrong. A flat
scaled at half its real size will show coverage reaching about twice as far as it
does, and nothing on screen will look suspicious.

Radio does not scale linearly either. Doubling the distance costs 6 dB of
spreading, but doubling a wall thickness can cost far more or, at the wrong
frequency, slightly less. There is no way to correct for a scale error after the
fact.

## Choosing what to measure

**Best: a dimension printed on the plan.** Architectural drawings usually carry a
few. Use the longest one you can find, because a click that is two pixels off
matters much less over ten metres than over one.

**Second best: a long overall dimension.** The outside width of the building, or
the length of a corridor.

**If the plan has no dimensions**, measure something in the real building that
you can also point to on the drawing. Good candidates, in order of reliability:

| What | Typical value | Reliability |
| --- | --- | --- |
| A wall you measured yourself | your figure | perfect |
| A room's long side, tape measured | your figure | perfect |
| Interior door leaf | 0.80 m or 0.90 m in most of Europe | good |
| Standard brick length | 0.24 m | good if you can count courses |
| Stair tread depth | 0.25 to 0.29 m | rough |

Do not scale off furniture drawn on the plan. Furniture symbols are decoration
and are frequently not to scale.

## Checking it afterwards

The statistics panel shows the measured thickness range of your traced walls.
After setting the scale, look at it. In ordinary European construction you should
see something in the region of:

- Interior partitions: 0.10 to 0.15 m
- Interior load-bearing walls: 0.17 to 0.25 m
- Exterior walls: 0.25 to 0.45 m

If every wall in your building comes out at 40 mm, or at 2 m, the scale is wrong.
Set it again.

A second check: pick a room you know the size of and measure it with the same
two-point tool. If your living room comes out at 3.9 m and you know it is 4.0 m,
you are fine. If it comes out at 7 m, you are not.

## Next

[Build the model](/guide/model).
