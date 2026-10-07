// Visual QA ported from the prototype's audit.js. Each function runs inside the page (Playwright
// serializes it), so it must not use anything from this module's scope.

/**
 * SVG checks: text clipped by the SVG, text over text, a line through a label, a filled shape over
 * a label, a label outside its box, foreignObject overflow. Returns one string per issue.
 */
export const auditSvgs = (args: { readonly selector: string; readonly ctx: string }): Array<string> => {
  type Box = { left: number; right: number; top: number; bottom: number }
  const issues: Array<string> = []
  const R = (e: Element): Box => e.getBoundingClientRect()
  const shrink = (r: Box, p: number): Box => ({
    left: r.left + p,
    right: r.right - p,
    top: r.top + p,
    bottom: r.bottom - p,
  })
  const ov = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  const name = (t: Element) => `"${(t.textContent ?? "").trim().slice(0, 18)}"`
  // Shapes and strokes in the same group as a label belong to it (a node box, an edge and its
  // own label); React Flow puts an edge and its label in one `.react-flow__edge` group.
  const owner = (e: Element): Element => e.closest(".react-flow__edge") ?? e.closest("g") ?? e
  const sameOwner = (a: Element, b: Element) => owner(a) === owner(b) && owner(b) !== b

  document.querySelectorAll<SVGSVGElement>(args.selector).forEach((svg, n) => {
    const ctx = `${args.ctx}#${n}`
    const sv = svg.getBoundingClientRect()
    if (sv.width === 0) return
    const texts = [...svg.querySelectorAll("text")].filter((t) => (t.textContent ?? "").trim() !== "")
    for (const t of texts) {
      const r = R(t)
      if (r.left < sv.left - 1 || r.right > sv.right + 1 || r.top < sv.top - 1 || r.bottom > sv.bottom + 1) {
        issues.push(`${ctx} clipped ${name(t)}`)
      }
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i]
        const b = texts[j]
        if (a !== undefined && b !== undefined && ov(shrink(R(a), 1.5), shrink(R(b), 1.5))) {
          issues.push(`${ctx} text×text ${name(a)} ${name(b)}`)
        }
      }
    }
    const strokes = [...svg.querySelectorAll<SVGGeometryElement>("line, path, polyline")].filter(
      (s) => s.closest("marker") === null && getComputedStyle(s).stroke !== "transparent",
    )
    const shapes = [...svg.querySelectorAll<SVGGraphicsElement>("circle, polygon, rect")].filter(
      (s) => s.closest("marker") === null,
    )
    for (const t of texts) {
      const tr = shrink(R(t), 1.5)
      for (const s of strokes) {
        if (sameOwner(s, t)) continue
        const m = s.getScreenCTM()
        if (m === null) continue
        let length = 0
        try {
          length = s.getTotalLength()
        } catch {
          continue
        }
        for (let k = 0; k <= 60; k++) {
          const p = s.getPointAtLength((length * k) / 60)
          const x = p.x * m.a + p.y * m.c + m.e
          const y = p.x * m.b + p.y * m.d + m.f
          if (x > tr.left && x < tr.right && y > tr.top && y < tr.bottom) {
            const part = s.getAttribute("data-p")
            issues.push(`${ctx} line-through ${name(t)} (${s.tagName}${part === null ? "" : ` ${part}`})`)
            break
          }
        }
      }
      for (const s of shapes) {
        if (sameOwner(s, t)) continue
        const fillOpacity = Number(s.getAttribute("fill-opacity") ?? 1)
        const style = getComputedStyle(s)
        if (fillOpacity < 0.4 || Number(style.fillOpacity) < 0.4) continue
        if ((s.getAttribute("fill") === "none" || style.fill === "none") && s.tagName !== "circle") continue
        if (style.fill === "transparent" || style.fill === "rgba(0, 0, 0, 0)") continue
        const r = s.getBoundingClientRect()
        if (r.width * r.height > sv.width * sv.height * 0.3) continue
        if (ov(tr, shrink(r, 1))) {
          const part = s.getAttribute("data-p")
          issues.push(`${ctx} shape-over ${name(t)} (${s.tagName}${part === null ? "" : ` ${part}`})`)
        }
      }
    }
    svg.querySelectorAll("g").forEach((g) => {
      const rect = g.querySelector(":scope > rect")
      if (rect === null) return
      const rr = R(rect)
      g.querySelectorAll(":scope > text").forEach((t) => {
        const r = R(t)
        if (r.left < rr.left + 2 || r.right > rr.right - 2) issues.push(`${ctx} text-outside-box ${name(t)}`)
      })
    })
    svg.querySelectorAll("foreignObject").forEach((f) => {
      const d = f.firstElementChild
      if (!(d instanceof HTMLElement) || !(f instanceof SVGForeignObjectElement)) return
      if (d.scrollWidth > f.width.baseVal.value + 1 || d.scrollHeight > f.height.baseVal.value + 1) {
        issues.push(`${ctx} foreignObject overflow ${d.innerText.slice(0, 20)}`)
      }
    })
  })
  return [...new Set(issues)]
}

/**
 * React Flow checks (its nodes are HTML, edges SVG): node over node, a label wider or taller than
 * its node, an edge label over a node, a node outside the visible pane.
 */
export const auditFlow = (args: { readonly selector: string; readonly ctx: string }): Array<string> => {
  type Box = { left: number; right: number; top: number; bottom: number }
  const issues: Array<string> = []
  const ov = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  const shrink = (r: Box, p: number): Box => ({
    left: r.left + p,
    right: r.right - p,
    top: r.top + p,
    bottom: r.bottom - p,
  })
  document.querySelectorAll(args.selector).forEach((flow, n) => {
    const ctx = `${args.ctx}#${n}`
    const pane = flow.getBoundingClientRect()
    const nodes = [...flow.querySelectorAll<HTMLElement>(".react-flow__node")]
    const name = (e: Element) => `"${(e.textContent ?? "").trim().slice(0, 18)}"`
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      if (a === undefined) continue
      const ra = a.getBoundingClientRect()
      if (
        ra.left < pane.left - 1 ||
        ra.right > pane.right + 1 ||
        ra.top < pane.top - 1 ||
        ra.bottom > pane.bottom + 1
      ) {
        issues.push(`${ctx} node outside pane ${name(a)}`)
      }
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        if (b !== undefined && ov(shrink(ra, 1), shrink(b.getBoundingClientRect(), 1))) {
          issues.push(`${ctx} node×node ${name(a)} ${name(b)}`)
        }
      }
      const button = a.querySelector<HTMLElement>(".lsn-node")
      if (button !== null) {
        if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) {
          issues.push(`${ctx} label overflows node ${name(a)}`)
        }
        const br = button.getBoundingClientRect()
        if (br.right > ra.right + 1 || br.bottom > ra.bottom + 1)
          issues.push(`${ctx} label outside node ${name(a)}`)
      }
    }
    flow
      .querySelectorAll(".react-flow__edge-textwrapper, .react-flow__edgelabel-renderer > *")
      .forEach((label) => {
        const lr = shrink(label.getBoundingClientRect(), 1)
        for (const node of nodes) {
          if (ov(lr, node.getBoundingClientRect()))
            issues.push(`${ctx} edge label over node ${name(label)} ${name(node)}`)
        }
      })
  })
  return [...new Set(issues)]
}
