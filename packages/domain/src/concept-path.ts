// Pure prerequisite-path walk and topological ordering for shared concepts.
// Given a target concept slug, collects reachable prerequisites up to `maxConceptPath`
// and orders them prerequisites-first (target last).

export const maxConceptPath = 64

export interface ConceptPathNode {
  readonly slug: string
  readonly needs: ReadonlyArray<string>
}

export interface ConceptPathEdge {
  /** Prerequisite slug. */
  readonly from: string
  /** Dependent slug that requires `from`. */
  readonly to: string
}

export interface OrderedConceptPath<N extends ConceptPathNode = ConceptPathNode> {
  readonly target: string
  /** Topological order: prerequisites first, target last. */
  readonly order: ReadonlyArray<N>
  /** Prerequisite edges within `order` (`from` is needed by `to`). */
  readonly edges: ReadonlyArray<ConceptPathEdge>
  /** True when more reachable prerequisites existed beyond `maxConcepts`. */
  readonly truncated: boolean
}

/**
 * Collect up to `maxConcepts` reachable nodes from `target` in `lookup` (BFS from target) and
 * return them in deterministic topological order (prerequisites first, target last).
 */
export const orderConceptPath = <N extends ConceptPathNode>(
  target: string,
  lookup: ReadonlyMap<string, N>,
  maxConcepts: number = maxConceptPath,
  alreadyTruncated = false,
): OrderedConceptPath<N> => {
  const cap = Math.max(1, maxConcepts)
  const root = lookup.get(target)
  if (root === undefined) {
    return { target, order: [], edges: [], truncated: alreadyTruncated }
  }

  // BFS from target to select up to `cap` closest prerequisites deterministically.
  const collected = new Map<string, N>()
  const depth = new Map<string, number>()
  const queue: Array<string> = [target]
  collected.set(target, root)
  depth.set(target, 0)
  let truncated = alreadyTruncated

  for (let head = 0; head < queue.length; head++) {
    const slug = queue[head]
    if (slug === undefined) continue
    const node = collected.get(slug)
    const d = depth.get(slug) ?? 0
    if (node === undefined) continue
    for (const need of node.needs) {
      if (collected.has(need)) continue
      const next = lookup.get(need)
      if (next === undefined) continue
      if (collected.size >= cap) {
        truncated = true
        continue
      }
      collected.set(need, next)
      depth.set(need, d + 1)
      queue.push(need)
    }
  }

  // Build subgraph over `collected`: edge `need -> slug` means `need` must be learned before `slug`.
  const edges: Array<ConceptPathEdge> = []
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, Array<string>>()
  for (const slug of collected.keys()) {
    inDegree.set(slug, 0)
    dependents.set(slug, [])
  }
  for (const [slug, node] of collected) {
    const seen = new Set<string>()
    for (const need of node.needs) {
      if (need === slug || seen.has(need) || !collected.has(need)) continue
      seen.add(need)
      edges.push({ from: need, to: slug })
      inDegree.set(slug, (inDegree.get(slug) ?? 0) + 1)
      dependents.get(need)?.push(slug)
    }
  }

  // Kahn's topological sort: deepest prerequisites first, then lexicographical by slug, target last.
  const compareReady = (a: string, b: string): number => {
    if (a === target && b !== target) return 1
    if (b === target && a !== target) return -1
    const depthDiff = (depth.get(b) ?? 0) - (depth.get(a) ?? 0)
    if (depthDiff !== 0) return depthDiff
    return a.localeCompare(b)
  }

  const ready: Array<string> = []
  for (const [slug, deg] of inDegree) {
    if (deg === 0) ready.push(slug)
  }
  ready.sort(compareReady)

  const orderedSlugs: Array<string> = []
  const placed = new Set<string>()
  while (ready.length > 0) {
    const current = ready.shift()
    if (current === undefined) break
    orderedSlugs.push(current)
    placed.add(current)
    for (const dep of dependents.get(current) ?? []) {
      const nextDeg = (inDegree.get(dep) ?? 1) - 1
      inDegree.set(dep, nextDeg)
      if (nextDeg === 0) {
        ready.push(dep)
        ready.sort(compareReady)
      }
    }
  }

  // Defensive fallback if input contained a cycle: append remaining nodes deterministically.
  if (placed.size < collected.size) {
    const remaining = [...collected.keys()].filter((slug) => !placed.has(slug)).sort(compareReady)
    orderedSlugs.push(...remaining)
  }

  const order = orderedSlugs.flatMap((slug) => {
    const node = collected.get(slug)
    return node === undefined ? [] : [node]
  })
  const orderIndex = new Map(orderedSlugs.map((slug, index) => [slug, index]))
  edges.sort(
    (a, b) =>
      (orderIndex.get(a.from) ?? 0) - (orderIndex.get(b.from) ?? 0) ||
      (orderIndex.get(a.to) ?? 0) - (orderIndex.get(b.to) ?? 0),
  )
  return { target, order, edges, truncated }
}

/**
 * Walk prerequisites from `target` using an async loader (e.g. `GET /api/concepts/:slug`),
 * fetching wave by wave up to `maxConcepts` unique concepts, then return them topologically ordered.
 */
export const walkConceptPath = async <N extends ConceptPathNode>(
  target: string,
  load: (slug: string) => Promise<N | undefined>,
  maxConcepts: number = maxConceptPath,
): Promise<OrderedConceptPath<N>> => {
  const cap = Math.max(1, maxConcepts)
  const loaded = new Map<string, N>()
  const attempted = new Set<string>()
  let frontier: Array<string> = [target]
  let truncated = false

  while (frontier.length > 0) {
    const remaining = cap - loaded.size
    if (remaining <= 0) {
      truncated = true
      break
    }
    const unique = [...new Set(frontier)].filter((slug) => !attempted.has(slug))
    if (unique.length === 0) break
    const batch = unique.slice(0, remaining)
    if (unique.length > remaining) truncated = true
    for (const slug of batch) attempted.add(slug)

    const fetched = await Promise.all(batch.map((slug) => load(slug)))
    const nextFrontier: Array<string> = []
    for (const node of fetched) {
      if (node === undefined) continue
      loaded.set(node.slug, node)
      for (const need of node.needs) {
        if (!attempted.has(need)) nextFrontier.push(need)
      }
    }
    if (loaded.size >= cap && nextFrontier.length > 0) {
      truncated = true
      break
    }
    frontier = nextFrontier
  }

  return orderConceptPath(target, loaded, cap, truncated)
}
