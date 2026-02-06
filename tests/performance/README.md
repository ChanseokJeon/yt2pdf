# Performance Tests

## What are Performance Tests?

Performance tests measure system behavior under specific conditions: execution time, memory usage, throughput, and latency. They establish baselines and detect regressions that would be invisible to functional tests.

Also called "benchmark tests" or "load tests", these ensure the system remains performant as it evolves.

## When to Use

- Critical path operations (PDF generation, video processing)
- Large data processing (batch operations, many videos)
- Memory-intensive operations (image handling, streaming)
- API response time requirements
- Detecting performance regressions
- Establishing performance baselines
- Optimization validation

## How It Works

1. **Measure** - Execute operation multiple times and record timing/memory
2. **Baseline** - Store typical performance as reference
3. **Monitor** - Compare new runs against baseline
4. **Alert** - Flag significant regressions (e.g., 10%+ slower)
5. **Improve** - Use metrics to guide optimization efforts

## Example Test

```typescript
describe('Performance: PDF Generation', () => {
  it('generates 1-hour video PDF in under 30 seconds', async () => {
    const start = performance.now();
    await generatePdf(oneHourVideo);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(30000); // 30 seconds
  });

  it('processes screenshots without exceeding 512MB memory', async () => {
    const initial = process.memoryUsage().heapUsed;
    await extractScreenshots(oneHourVideo);
    const final = process.memoryUsage().heapUsed;
    const used = final - initial;

    expect(used).toBeLessThan(512 * 1024 * 1024); // 512MB
  });

  it('YouTube API calls average under 200ms', async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await youtubeApi.getVideo(testVideoIds[i]);
      times.push(performance.now() - start);
    }
    const avg = times.reduce((a, b) => a + b) / times.length;

    expect(avg).toBeLessThan(200);
  });
});
```

## Running Performance Tests

```bash
# Run all performance tests
npm test -- tests/performance

# Run with detailed timing output
npm test -- tests/performance --verbose

# Generate performance report
npm test -- tests/performance --report

# Compare against previous baseline
npm test -- tests/performance --compare-baseline

# Profile a specific test
npm test -- tests/performance -t "PDF Generation" --profile
```

## Tips

- Run performance tests in isolation (no other processes)
- Use consistent hardware/environment for fair comparisons
- Measure multiple runs and use averages
- Set realistic thresholds (not too tight, not too loose)
- Document why specific thresholds matter
- Monitor trends over time, not just individual tests
- Consider using tools like `clinic.js` or `autocannon` for detailed profiling
- Run performance tests on CI but with warnings, not failures (hardware varies)
