import { describe, expect, it } from "vitest";
import {
  ADOPTION_MIN_DELIBERATION_DAYS,
  autoCloseEligibility,
} from "./autoCloseProposals";
import type { Proposal, Vote, VoteChoice } from "@/types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const CONFIG = { proposalDeliberationDays: 3, proposalMinAffirms: 2 };
const VOTERS = ["a", "b", "c"] as const;
const CHOICES: VoteChoice[] = ["affirm", "abstain", "block"];

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    nodeId: "n",
    kind: "proposal",
    category: "config_change",
    reversibilityTier: "easy",
    title: "T",
    description: "",
    payload: "{}",
    proposerKey: "proposer",
    status: "open",
    createdAt: NOW - 5 * DAY,
    closedAt: null,
    closedReason: null,
    impactReflection: null,
    disputePostId: null,
    ...overrides,
  };
}

function vote(voterKey: string, choice: VoteChoice, createdAt = NOW): Vote {
  return {
    id: `p1|${voterKey}`,
    proposalId: "p1",
    voterKey,
    choice,
    reason: null,
    createdAt,
    nodeId: "n",
  };
}

function everyVoteProfile(): Vote[][] {
  const profiles: Vote[][] = [];
  for (const a of CHOICES) {
    for (const b of CHOICES) {
      for (const c of CHOICES) {
        profiles.push([
          vote(VOTERS[0], a),
          vote(VOTERS[1], b),
          vote(VOTERS[2], c),
        ]);
      }
    }
  }
  return profiles;
}

function everyTrustedSubset(): Set<string>[] {
  const sets: Set<string>[] = [];
  for (let mask = 0; mask < 1 << VOTERS.length; mask++) {
    const set = new Set<string>();
    for (let i = 0; i < VOTERS.length; i++) {
      if ((mask & (1 << i)) !== 0) set.add(VOTERS[i]);
    }
    sets.push(set);
  }
  return sets;
}

describe("autoCloseEligibility bounded invariants", () => {
  const profiles = everyVoteProfile();
  const trustedSubsets = everyTrustedSubset();

  it("standing blocks dominate every trusted subset and every deliberation state", () => {
    for (const votes of profiles) {
      const hasBlock = votes.some((entry) => entry.choice === "block");
      if (!hasBlock) continue;
      for (const trustedKeys of trustedSubsets) {
        for (const now of [NOW - DAY, NOW]) {
          const result = autoCloseEligibility({
            proposal: proposal({ createdAt: NOW - 2 * DAY }),
            votes,
            config: CONFIG,
            trustedKeys,
            now,
          });
          expect(result.kind).toBe("blocked");
        }
      }
    }
  });

  it("without blocks, the result is exactly the deliberation/affirm predicate over all bounded profiles", () => {
    for (const votes of profiles) {
      if (votes.some((entry) => entry.choice === "block")) continue;
      for (const trustedKeys of trustedSubsets) {
        const countedAffirms = votes.filter(
          (entry) =>
            entry.choice === "affirm" && trustedKeys.has(entry.voterKey),
        ).length;

        const beforeReady = autoCloseEligibility({
          proposal: proposal({ createdAt: NOW - 2 * DAY }),
          votes,
          config: CONFIG,
          trustedKeys,
          now: NOW,
        });
        expect(beforeReady.kind).toBe("wait_deliberation");

        const afterReady = autoCloseEligibility({
          proposal: proposal(),
          votes,
          config: CONFIG,
          trustedKeys,
          now: NOW,
        });
        expect(afterReady.kind).toBe(
          countedAffirms >= CONFIG.proposalMinAffirms
            ? "passes"
            : "wait_affirms",
        );
      }
    }
  });

  it("null trustedKeys preserves the flat-count rule across all bounded profiles", () => {
    for (const votes of profiles) {
      const result = autoCloseEligibility({
        proposal: proposal(),
        votes,
        config: CONFIG,
        trustedKeys: null,
        now: NOW,
      });
      if (votes.some((entry) => entry.choice === "block")) {
        expect(result.kind).toBe("blocked");
        continue;
      }
      const affirmCount = votes.filter(
        (entry) => entry.choice === "affirm",
      ).length;
      expect(result.kind).toBe(
        affirmCount >= CONFIG.proposalMinAffirms ? "passes" : "wait_affirms",
      );
    }
  });

  it("project adoption keeps its 14-day floor as an executable invariant", () => {
    const votes = [vote("a", "affirm"), vote("b", "affirm")];
    const trustedKeys = new Set(["a", "b"]);

    const early = autoCloseEligibility({
      proposal: proposal({
        category: "project_adoption",
        createdAt: NOW - (ADOPTION_MIN_DELIBERATION_DAYS - 1) * DAY,
      }),
      votes,
      config: CONFIG,
      trustedKeys,
      now: NOW,
    });
    expect(early.kind).toBe("wait_deliberation");

    const ripe = autoCloseEligibility({
      proposal: proposal({
        category: "project_adoption",
        createdAt: NOW - ADOPTION_MIN_DELIBERATION_DAYS * DAY,
      }),
      votes,
      config: CONFIG,
      trustedKeys,
      now: NOW,
    });
    expect(ripe.kind).toBe("passes");
  });
});
