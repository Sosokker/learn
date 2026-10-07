// A small lesson for the widgets the guide doesn't use: incline, trace, flow and a study plan.
export const widgetsDemo: unknown = {
  schema: 1,
  kind: "learn",
  lang: "en",
  title: "Widget sampler",
  summary: "Incline, trace, flow and units, which the guide does not use.",
  parts: {
    w: { label: "$mg$", role: "given", color: "orange", meaning: "weight" },
    n: { label: "$N$", role: "derived", color: "cyan", meaning: "normal force" },
    f: { label: "$f$", role: "derived", color: "red", meaning: "friction" },
    a: { label: "$a$", role: "goal", color: "green", meaning: "acceleration down the slope" },
    rev: { label: "revenue", role: "metric", color: "purple", meaning: "money in" },
  },
  cards: {
    newton2: { kind: "law", title: "Newton's second law", body: "$\\sum F = ma$ along each axis." },
    loop: { kind: "term", title: "Loop", body: "Runs the body again while the condition holds." },
  },
  sections: [
    {
      id: "slope",
      type: "visual",
      title: "Block on a slope",
      note: "tilt it; friction holds until the slope is steep enough",
      widget: {
        kind: "incline",
        params: [
          { id: "angle", label: "angle $\\theta$ (°)", min: 0, max: 60, step: 1, value: 30 },
          { id: "mu", label: "friction $\\mu$", min: 0, max: 1, step: 0.05, value: 0.3, part: "f" },
        ],
        forces: ["weight", "normal", "friction", "accel"],
        parts: { weight: "w", normal: "n", friction: "f", accel: "a" },
      },
    },
    {
      id: "code",
      type: "visual",
      title: "Trace a loop",
      widget: {
        kind: "trace",
        lang: "python",
        code: "total = 0\nfor i in range(3):\n    total += i\nprint(total)",
        steps: [
          { line: 1, note: "Start at zero.", state: { total: "0" } },
          { line: 2, note: "First pass of the {loop|loop}.", state: { total: "0", i: "0" } },
          { line: 3, note: "Add `i`.", state: { total: "1", i: "1" } },
          { line: 4, note: "Done: **3**.", state: { total: "3" } },
        ],
      },
    },
    {
      id: "money",
      type: "visual",
      title: "Where the money goes",
      widget: {
        kind: "flow",
        nodes: [
          { id: "user", label: "customer" },
          { id: "shop", label: "shop", part: "rev" },
          { id: "bank", label: "bank", card: "loop" },
        ],
        edges: [
          { from: "user", to: "shop", label: "pays", part: "rev" },
          { from: "shop", to: "bank", label: "deposits" },
        ],
      },
    },
    {
      id: "plan",
      type: "units",
      title: "Study plan",
      units: [
        {
          id: "u1",
          title: "Forces",
          milestone: "Draw a free-body diagram for [w:weight] and [n:normal force].",
        },
        {
          id: "u2",
          title: "{newton2|Newton's second law}",
          milestone: "Find [a:$a$] on a slope.",
          lessonSlug: "incline",
        },
      ],
    },
  ],
}
