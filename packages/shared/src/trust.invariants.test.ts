import { describe, expect, it } from "vitest";
import { computeTrustedSet, type TrustEdge } from "./trust.js";

function sortSet(values: ReadonlySet<string>): string[] {
  return [...values].sort();
}

function possibleEdges(nodes: readonly string[]): TrustEdge[] {
  const edges: TrustEdge[] = [];
  for (const voucherKey of nodes) {
    for (const voucheeKey of nodes) {
      if (voucherKey === voucheeKey) continue;
      edges.push({ voucherKey, voucheeKey });
    }
  }
  return edges;
}

function edgesFromMask(all: readonly TrustEdge[], mask: number): TrustEdge[] {
  const chosen: TrustEdge[] = [];
  for (let i = 0; i < all.length; i++) {
    if ((mask & (1 << i)) !== 0) chosen.push(all[i]);
  }
  return chosen;
}

function reachableFromRoots(
  roots: ReadonlySet<string>,
  edges: readonly TrustEdge[],
): Set<string> {
  const seen = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (seen.has(edge.voucherKey) && !seen.has(edge.voucheeKey)) {
        seen.add(edge.voucheeKey);
        changed = true;
      }
    }
  }
  return seen;
}

describe("computeTrustedSet bounded invariants", () => {
  it("with one founder root, no bounded graph can bootstrap a second trusted member", () => {
    const founder = "founder";
    const members = ["alice", "bob", "carol"];
    const nodes = [founder, ...members];
    const allEdges = possibleEdges(nodes);
    const roots = new Set([founder]);

    for (let mask = 0; mask < 1 << allEdges.length; mask++) {
      const trusted = computeTrustedSet(roots, edgesFromMask(allEdges, mask));
      expect(sortSet(trusted)).toEqual([founder]);
    }
  });

  it("for every bounded two-founder graph, trusted membership is order-independent and justified by two trusted incoming vouchers", () => {
    const founders = ["founderA", "founderB"];
    const members = ["alice", "bob"];
    const nodes = [...founders, ...members];
    const allEdges = possibleEdges(nodes);
    const roots = new Set(founders);

    for (let mask = 0; mask < 1 << allEdges.length; mask++) {
      const edges = edgesFromMask(allEdges, mask);
      const trusted = computeTrustedSet(roots, edges);
      const reversed = computeTrustedSet(roots, [...edges].reverse());
      const duplicated = computeTrustedSet(roots, [...edges, ...edges]);
      const reachable = reachableFromRoots(roots, edges);

      expect(sortSet(trusted)).toEqual(sortSet(reversed));
      expect(sortSet(trusted)).toEqual(sortSet(duplicated));

      for (const member of members) {
        if (!trusted.has(member)) continue;
        const incomingTrusted = new Set(
          edges
            .filter(
              (edge) =>
                edge.voucheeKey === member && trusted.has(edge.voucherKey),
            )
            .map((edge) => edge.voucherKey),
        );
        expect(incomingTrusted.size).toBeGreaterThanOrEqual(2);
        expect(reachable.has(member)).toBe(true);
      }
    }
  });
});
