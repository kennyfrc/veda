import { expect, test, describe } from "bun:test";
import { XML_JUDGE_FORMAT } from "../src/core/judge-format";

describe("Consensus Judge Parser", () => {
  const mapping = [0, 1, 2];

  test("should parse all consensus fields correctly", () => {
    const xml = `
<consensus_analysis>
Candidates 1 and 2 share the same logic. Candidate 3 is an outlier.
</consensus_analysis>
<reason>
Candidate 1 is more detailed than Candidate 2.
</reason>
<best>1</best>
<confidence>high</confidence>
`;
    const result = XML_JUDGE_FORMAT.parse(xml, mapping);
    expect(result.selectedIndex).toBe(0);
    expect(result.confidence).toBe(0.9);
    expect(result.consensusAnalysis).toBe("Candidates 1 and 2 share the same logic. Candidate 3 is an outlier.");
    expect(result.reasoning).toBe("Candidate 1 is more detailed than Candidate 2.");
  });

  test("should handle missing consensus analysis gracefully", () => {
    const xml = `
<reason>Simple reasoning.</reason>
<best>2</best>
<confidence>medium</confidence>
`;
    const result = XML_JUDGE_FORMAT.parse(xml, mapping);
    expect(result.selectedIndex).toBe(1);
    expect(result.consensusAnalysis).toBeUndefined();
    expect(result.reasoning).toBe("Simple reasoning.");
  });

  test("should handle tags in different orders", () => {
    const xml = `
<best>3</best>
<confidence>low</confidence>
<consensus_analysis>Out of order.</consensus_analysis>
<reason>Reasoning last.</reason>
`;
    const result = XML_JUDGE_FORMAT.parse(xml, mapping);
    expect(result.selectedIndex).toBe(2);
    expect(result.consensusAnalysis).toBe("Out of order.");
    expect(result.reasoning).toBe("Reasoning last.");
  });

  test("should handle extra whitespace and newlines", () => {
    const xml = `
      <best>  2  </best>
      <consensus_analysis>
        Line 1
        Line 2
      </consensus_analysis>
    `;
    const result = XML_JUDGE_FORMAT.parse(xml, mapping);
    expect(result.selectedIndex).toBe(1);
    expect(result.consensusAnalysis).toBe("Line 1\n        Line 2");
  });

  test("should handle instruction echoing in best tag", () => {
    const xml = `
      <best>the best candidate is 3</best>
      <confidence>high</confidence>
    `;
    const result = XML_JUDGE_FORMAT.parse(xml, mapping);
    // Should still extract '3' (mapped to original index 2)
    expect(result.selectedIndex).toBe(2);
  });

  test("should handle multiple numbers in best tag by picking the last one", () => {
    const xml = `
      <best>From the range 1-4, I choose 3</best>
      <confidence>high</confidence>
    `;
    const result = XML_JUDGE_FORMAT.parse(xml, mapping);
    // Should extract '3' (the last number), not '1' or '4'
    expect(result.selectedIndex).toBe(2);
  });

  test("should be deterministic when seeded", () => {
    const arr = ["a", "b", "c", "d", "e"];
    const seed = "test-seed";
    const res1 = XML_JUDGE_FORMAT.format(arr, [0, 1, 2, 3, 4], "task");
    
    const { indexMapping: mapping1 } = XML_JUDGE_FORMAT.shuffle ? (XML_JUDGE_FORMAT as any).shuffle(arr, seed) : { indexMapping: [0, 1, 2, 3, 4] };
    const { indexMapping: mapping2 } = XML_JUDGE_FORMAT.shuffle ? (XML_JUDGE_FORMAT as any).shuffle(arr, seed) : { indexMapping: [0, 1, 2, 3, 4] };
    
    // Direct test on shuffleCandidates since XML_JUDGE_FORMAT doesn't expose it directly in its type
    const { indexMapping: m1 } = require("../src/core/judge-format").shuffleCandidates(arr, seed);
    const { indexMapping: m2 } = require("../src/core/judge-format").shuffleCandidates(arr, seed);
    
    expect(m1).toEqual(m2);
    
    const { indexMapping: m3 } = require("../src/core/judge-format").shuffleCandidates(arr, "different-seed");
    expect(m1).not.toEqual(m3);
  });
});
