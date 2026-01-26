/**
 * 비용 추정기 테스트
 */

import { CostEstimator } from '../../../src/core/cost-estimator';

describe('CostEstimator', () => {
  describe('estimate', () => {
    it('should estimate cost for Whisper API', () => {
      // 60초 = 1분 = $0.006
      const result = CostEstimator.estimate(60);
      expect(result.whisperCost).toBe(0.006);
      expect(result.totalCost).toBe(0.006);
      expect(result.currency).toBe('USD');
    });

    it('should round up to next minute', () => {
      // 61초 = 2분 = $0.012
      const result = CostEstimator.estimate(61);
      expect(result.whisperCost).toBe(0.012);
    });

    it('should include breakdown', () => {
      const result = CostEstimator.estimate(300); // 5분
      expect(result.breakdown.whisper).toBeDefined();
      expect(result.breakdown.whisper?.minutes).toBe(5);
      expect(result.breakdown.whisper?.costPerMinute).toBe(0.006);
    });
  });

  describe('formatCost', () => {
    it('should format cost correctly', () => {
      const estimate = CostEstimator.estimate(60);
      expect(CostEstimator.formatCost(estimate)).toBe('$0.006');
    });
  });

  describe('getSummary', () => {
    it('should return formatted summary', () => {
      const estimate = CostEstimator.estimate(600); // 10분
      const summary = CostEstimator.getSummary(estimate);

      expect(summary).toContain('예상 비용');
      expect(summary).toContain('Whisper API');
      expect(summary).toContain('10분');
    });
  });

  describe('isFree', () => {
    it('should return true when YouTube captions available', () => {
      expect(CostEstimator.isFree(true)).toBe(true);
    });

    it('should return false when YouTube captions not available', () => {
      expect(CostEstimator.isFree(false)).toBe(false);
    });
  });
});
