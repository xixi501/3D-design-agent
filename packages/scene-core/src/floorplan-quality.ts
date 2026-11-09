/** Production-like candidate-pool scoring. Evaluation-only; never import from runtime services. */

export interface CandidateMatch {
  actual: number;
  reference: number;
  cost: number;
}

export interface MatchEdge {
  actual: number;
  reference: number;
  cost: number;
}

export interface MatchResult {
  matches: CandidateMatch[];
  ambiguousReferenceCount: number;
  ambiguousActualCount: number;
  unmatchedReferenceCount: number;
  unmatchedActualCount: number;
}

const ratio = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : 1;

/**
 * Finds a maximum-cardinality matching first, then the minimum edge cost among
 * all maximum matchings. A single candidate can therefore never earn recall for
 * two reference instances.
 */
export function maximumCardinalityMinimumCostMatching(
  actualCount: number,
  referenceCount: number,
  inputEdges: MatchEdge[],
): MatchResult {
  if (
    !Number.isInteger(actualCount) ||
    !Number.isInteger(referenceCount) ||
    actualCount < 0 ||
    referenceCount < 0
  )
    throw new Error("候选和参考数量必须是非负整数");
  const edges = inputEdges
    .map((edge) => ({ ...edge }))
    .sort(
      (left, right) =>
        left.actual - right.actual ||
        left.reference - right.reference ||
        left.cost - right.cost,
    );
  for (const edge of edges) {
    if (
      !Number.isInteger(edge.actual) ||
      !Number.isInteger(edge.reference) ||
      edge.actual < 0 ||
      edge.actual >= actualCount ||
      edge.reference < 0 ||
      edge.reference >= referenceCount ||
      !Number.isFinite(edge.cost) ||
      edge.cost < 0
    )
      throw new Error("匹配边索引或成本无效");
  }

  const source = 0;
  const actualOffset = 1;
  const referenceOffset = actualOffset + actualCount;
  const sink = referenceOffset + referenceCount;
  const nodeCount = sink + 1;
  const graph = Array.from(
    { length: nodeCount },
    () =>
      [] as Array<{
        to: number;
        reverse: number;
        capacity: number;
        cost: number;
      }>,
  );

  const addEdge = (
    from: number,
    to: number,
    capacity: number,
    cost: number,
  ) => {
    const forward = { to, reverse: graph[to].length, capacity, cost };
    const reverse = {
      to: from,
      reverse: graph[from].length,
      capacity: 0,
      cost: -cost,
    };
    graph[from].push(forward);
    graph[to].push(reverse);
  };

  for (let index = 0; index < actualCount; index += 1)
    addEdge(source, actualOffset + index, 1, 0);
  for (let index = 0; index < referenceCount; index += 1)
    addEdge(referenceOffset + index, sink, 1, 0);
  for (const edge of edges)
    addEdge(
      actualOffset + edge.actual,
      referenceOffset + edge.reference,
      1,
      edge.cost,
    );

  while (true) {
    const distance = Array(nodeCount).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array(nodeCount).fill(-1);
    const previousEdge = Array(nodeCount).fill(-1);
    const inQueue = Array(nodeCount).fill(false);
    const queue = [source];
    distance[source] = 0;
    inQueue[source] = true;
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      inQueue[node] = false;
      for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex += 1) {
        const edge = graph[node][edgeIndex];
        if (
          edge.capacity > 0 &&
          distance[edge.to] > distance[node] + edge.cost + 1e-12
        ) {
          distance[edge.to] = distance[node] + edge.cost;
          previousNode[edge.to] = node;
          previousEdge[edge.to] = edgeIndex;
          if (!inQueue[edge.to]) {
            inQueue[edge.to] = true;
            queue.push(edge.to);
          }
        }
      }
    }
    if (previousNode[sink] < 0) break;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverse].capacity += 1;
    }
  }

  const matches: CandidateMatch[] = [];
  for (let actual = 0; actual < actualCount; actual += 1) {
    const node = actualOffset + actual;
    for (const edge of graph[node]) {
      if (edge.to >= referenceOffset && edge.to < sink && edge.capacity === 0)
        matches.push({
          actual,
          reference: edge.to - referenceOffset,
          cost: edge.cost,
        });
    }
  }
  matches.sort((left, right) => left.actual - right.actual);

  const actualDegrees = Array(actualCount).fill(0);
  const referenceDegrees = Array(referenceCount).fill(0);
  for (const edge of edges) {
    actualDegrees[edge.actual] += 1;
    referenceDegrees[edge.reference] += 1;
  }

  return {
    matches,
    ambiguousReferenceCount: referenceDegrees.filter((degree) => degree > 1)
      .length,
    ambiguousActualCount: actualDegrees.filter((degree) => degree > 1).length,
    unmatchedReferenceCount: referenceCount - matches.length,
    unmatchedActualCount: actualCount - matches.length,
  };
}

export interface PixelAxisSegment {
  orientation: "h" | "v";
  line: number;
  start: number;
  end: number;
}

function unionLength(intervals: Array<[number, number]>): number {
  const sorted = intervals
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let start = Number.NaN;
  let end = Number.NaN;
  for (const interval of sorted) {
    if (!Number.isFinite(start)) {
      start = interval[0];
      end = interval[1];
    } else if (interval[0] <= end + 1e-9) {
      end = Math.max(end, interval[1]);
    } else {
      total += end - start;
      start = interval[0];
      end = interval[1];
    }
  }
  if (Number.isFinite(start)) total += end - start;
  return total;
}

function axisCoverage(
  source: PixelAxisSegment[],
  target: PixelAxisSegment[],
  lineTolerance: number,
  extentTolerance: number,
): number {
  let matched = 0;
  let total = 0;
  for (const segment of source) {
    const length = segment.end - segment.start;
    if (length <= 0) continue;
    total += length;
    const overlaps: Array<[number, number]> = [];
    for (const other of target) {
      if (
        other.orientation !== segment.orientation ||
        Math.abs(other.line - segment.line) > lineTolerance
      )
        continue;
      const start = Math.max(segment.start, other.start - extentTolerance);
      const end = Math.min(segment.end, other.end + extentTolerance);
      if (end > start) overlaps.push([start, end]);
    }
    matched += Math.min(length, unionLength(overlaps));
  }
  return ratio(matched, total);
}

export function pixelWallCoverage(
  actual: PixelAxisSegment[],
  reference: PixelAxisSegment[],
  lineTolerance = 6,
  extentTolerance = 0,
) {
  return {
    precision: axisCoverage(actual, reference, lineTolerance, extentTolerance),
    recall: axisCoverage(reference, actual, lineTolerance, extentTolerance),
  };
}

export function exactDuplicateRate(
  candidates: Array<{
    start: number;
    end: number;
    line: number;
    orientation: string;
  }>,
  tolerance = 2,
): number {
  if (!candidates.length) return 0;
  let duplicates = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const duplicate = candidates.some(
      (other, otherIndex) =>
        otherIndex < index &&
        other.orientation === candidate.orientation &&
        Math.abs(other.line - candidate.line) <= tolerance &&
        Math.abs(other.start - candidate.start) <= tolerance &&
        Math.abs(other.end - candidate.end) <= tolerance,
    );
    if (duplicate) duplicates += 1;
  }
  return duplicates / candidates.length;
}

export function candidateRate(actualCount: number, referenceCount: number) {
  return referenceCount
    ? actualCount / referenceCount
    : actualCount
      ? Infinity
      : 0;
}
