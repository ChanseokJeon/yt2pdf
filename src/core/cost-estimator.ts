/**
 * 비용 추정기
 */

import { CostEstimate } from '../types/index.js';

export class CostEstimator {
  private static WHISPER_COST_PER_MINUTE = 0.006; // USD

  /**
   * Whisper API 비용 추정
   */
  static estimate(durationSeconds: number): CostEstimate {
    const minutes = Math.ceil(durationSeconds / 60);
    const whisperCost = minutes * this.WHISPER_COST_PER_MINUTE;

    return {
      whisperCost,
      totalCost: whisperCost,
      currency: 'USD',
      breakdown: {
        whisper: {
          minutes,
          costPerMinute: this.WHISPER_COST_PER_MINUTE,
        },
      },
    };
  }

  /**
   * 비용 포맷팅
   */
  static formatCost(estimate: CostEstimate): string {
    return `$${estimate.totalCost.toFixed(3)}`;
  }

  /**
   * 비용 요약 문자열
   */
  static getSummary(estimate: CostEstimate): string {
    const lines: string[] = [];

    lines.push('예상 비용:');

    if (estimate.breakdown.whisper) {
      const { minutes, costPerMinute } = estimate.breakdown.whisper;
      lines.push(`  - Whisper API: ${minutes}분 × $${costPerMinute}/분 = $${estimate.whisperCost.toFixed(3)}`);
    }

    lines.push(`  - 총 비용: ${this.formatCost(estimate)}`);

    return lines.join('\n');
  }

  /**
   * 무료 여부 확인 (YouTube 자막 사용 시)
   */
  static isFree(hasYouTubeCaptions: boolean): boolean {
    return hasYouTubeCaptions;
  }
}
