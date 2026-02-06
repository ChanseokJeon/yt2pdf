# Benchmarks

This directory contains performance benchmarks for the yt2pdf project.

## Quick Start

```bash
# Run benchmarks (no comparison)
npm run benchmark

# Save current results as baseline
npm run benchmark:baseline

# Compare current performance to baseline (fails if >10% slower)
npm run benchmark:compare
```

## Benchmarks Included

### 1. Build Time
- Measures TypeScript compilation time
- Full clean + build cycle
- Single iteration (most variable benchmark)

### 2. Text Normalization
- **HTML Entity Decode**: Decodes HTML entities (&amp;, &lt;, etc.)
- **Garbage Text Detection**: Detects malformed/corrupted text patterns
- **Subtitle Deduplication**: Removes duplicate rolling subtitle entries
- **Subtitle Text Cleaning**: Cleans YouTube subtitle text (tags, markers, etc.)
- **Korean Language Detection**: Detects Korean-dominant text
- **Mixed Language Cleaning**: Extracts target language from mixed text

### 3. PDF Generation
- **PDF Data Preparation**: Mock benchmark for data processing overhead
- Simulates formatting and data transformation (not actual I/O)

## Performance Threshold

The comparison mode fails if any benchmark is **>10% slower** than the baseline.

This prevents performance regressions in CI/CD pipelines.

## Output Format

```
📊 Comparison to baseline:

  🟢 build-time:
      Baseline: 2184.314ms
      Current:  2070.735ms
      Diff:     -113.578ms (-5.2%)

  ⚪ html-entity-decode:
      Baseline: 0.012ms
      Current:  0.012ms
      Diff:     +0.000ms (+2.5%)
```

- 🔴 = >10% slower (regression)
- 🟢 = >5% faster (improvement)
- ⚪ = Within acceptable range

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Performance Regression Check
  run: |
    npm run benchmark:baseline  # First run: save baseline
    npm run benchmark:compare   # Subsequent runs: compare
```

Or for existing baseline (committed to git):

```yaml
- name: Performance Regression Check
  run: npm run benchmark:compare
```

## Baseline File

The baseline is stored in `benchmarks/baseline.json` and includes:
- Timestamp
- System info (platform, arch, Node version, CPU)
- Benchmark results (name, iterations, timing)

You can commit this file to track performance over time.

## Customization

Edit `scripts/benchmark.js` to:
- Add new benchmarks
- Adjust iteration counts
- Change the regression threshold (default: 10%)
- Modify sample data
