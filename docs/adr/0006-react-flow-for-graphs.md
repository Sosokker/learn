# 0006: React Flow + dagre for graphs and flows; plain SVG for plots

**Status:** accepted, 2026-10-07

## Decision
The concept graph section and the `flow` widget use `@xyflow/react` with a `@dagrejs/dagre`
layered layout, lazy-loaded so they aren't in the main bundle. Plots, the incline scene and other
widgets are plain SVG drawn from the safe expression parser.

## Why
Use the right tool for each job. Graph layout, panning and edge routing are hard and React Flow
does them well. Plots are simple, need exact control over every pixel for the overlap audit, and
would pay for a chart library they barely use.
