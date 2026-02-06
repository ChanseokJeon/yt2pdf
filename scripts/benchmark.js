#!/usr/bin/env node
/**
 * Benchmark script for yt2pdf
 *
 * Usage:
 *   node scripts/benchmark.js                  # Run benchmarks
 *   node scripts/benchmark.js --save          # Save as baseline
 *   node scripts/benchmark.js --compare       # Compare to baseline
 */

const { performance, PerformanceObserver } = require('perf_hooks');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Paths
const BENCHMARK_DIR = path.join(__dirname, '../benchmarks');
const BASELINE_PATH = path.join(BENCHMARK_DIR, 'baseline.json');

// Sample data for benchmarks
const SAMPLE_TEXT = `
This is a sample subtitle text with HTML entities like &amp;, &lt;, &gt;, and &quot;.
It also has repeated patterns, repeated patterns, repeated patterns to test deduplication.
네, 네, 네, 네, 네 Korean text for language detection.
Some English text mixed with 한글 텍스트 혼재된 문장입니다.
&nbsp;&nbsp;Extra spaces and HTML entities&nbsp;to clean.
[♪♪♪] Music markers and &j&j&j YouTube markers.
`.repeat(10); // Make it substantial

const ROLLING_SUBTITLES = [
  'Hello and welcome to',
  'welcome to this video',
  'this video is about',
  'is about text processing',
  'text processing and subtitle',
  'and subtitle extraction',
];

// Ensure benchmark directory exists
if (!fs.existsSync(BENCHMARK_DIR)) {
  fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
}

/**
 * Run a benchmark and return the duration
 */
function benchmark(name, fn, iterations = 1000) {
  const startMark = `${name}-start`;
  const endMark = `${name}-end`;
  const measureName = `${name}-measure`;

  // Warm up
  for (let i = 0; i < Math.min(10, iterations); i++) {
    fn();
  }

  // Actual benchmark
  performance.mark(startMark);
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  performance.mark(endMark);

  performance.measure(measureName, startMark, endMark);
  const measure = performance.getEntriesByName(measureName)[0];
  const avgDuration = measure.duration / iterations;

  performance.clearMarks();
  performance.clearMeasures();

  return {
    name,
    iterations,
    totalMs: measure.duration,
    avgMs: avgDuration,
    opsPerSec: Math.round(1000 / avgDuration),
  };
}

/**
 * Build time benchmark
 */
function benchmarkBuild() {
  console.log('⚙️  Building project...');

  // Clean first
  try {
    execSync('npm run clean', { stdio: 'ignore' });
  } catch (e) {
    // Ignore if clean fails
  }

  const start = performance.now();
  execSync('npm run build', { stdio: 'ignore' });
  const duration = performance.now() - start;

  return {
    name: 'build-time',
    iterations: 1,
    totalMs: duration,
    avgMs: duration,
    opsPerSec: 0,
  };
}

/**
 * Text normalization benchmarks
 */
function benchmarkTextNormalization() {
  // Import text utilities
  const textUtils = require('../dist/utils/text.js');

  const results = [];

  // Benchmark 1: HTML entity decoding
  results.push(
    benchmark(
      'html-entity-decode',
      () => textUtils.decodeHtmlEntities(SAMPLE_TEXT),
      5000
    )
  );

  // Benchmark 2: Garbage text detection
  results.push(
    benchmark(
      'garbage-text-detection',
      () => textUtils.isGarbageText('굉b굄x 쓰레기`_ 텍스트'),
      10000
    )
  );

  // Benchmark 3: Subtitle deduplication
  results.push(
    benchmark(
      'subtitle-deduplication',
      () => textUtils.deduplicateSubtitles(ROLLING_SUBTITLES),
      2000
    )
  );

  // Benchmark 4: Subtitle text cleaning
  results.push(
    benchmark(
      'subtitle-text-cleaning',
      () => textUtils.cleanSubtitleText(SAMPLE_TEXT),
      3000
    )
  );

  // Benchmark 5: Korean language detection
  results.push(
    benchmark(
      'korean-language-detection',
      () => textUtils.isKoreanDominant('이것은 한글 텍스트입니다'),
      10000
    )
  );

  // Benchmark 6: Mixed language cleaning
  results.push(
    benchmark(
      'mixed-language-cleaning',
      () => textUtils.cleanMixedLanguageText('한글 text English 텍스트 mixed'),
      5000
    )
  );

  return results;
}

/**
 * PDF generation benchmark (mock)
 */
function benchmarkPDFGeneration() {
  // Create mock content
  const mockContent = {
    title: 'Benchmark Video',
    author: 'Benchmark Test',
    duration: 600,
    sections: Array.from({ length: 20 }, (_, i) => ({
      timestamp: i * 30,
      screenshot: null, // Mock - no actual image
      transcript: SAMPLE_TEXT,
    })),
  };

  // We'll benchmark the data preparation overhead
  // (actual PDF writing is I/O bound and variable)
  return benchmark(
    'pdf-data-preparation',
    () => {
      // Simulate data processing that PDF generator does
      const processed = mockContent.sections.map((section) => ({
        ...section,
        cleanedTranscript: section.transcript.trim().substring(0, 500),
        formattedTime: `${Math.floor(section.timestamp / 60)}:${(section.timestamp % 60).toString().padStart(2, '0')}`,
      }));
      return processed;
    },
    1000
  );
}

/**
 * Run all benchmarks
 */
function runBenchmarks() {
  console.log('🚀 Running benchmarks...\n');

  const results = {
    timestamp: new Date().toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cpus: require('os').cpus()[0].model,
    },
    benchmarks: {},
  };

  // Build time
  const buildResult = benchmarkBuild();
  results.benchmarks[buildResult.name] = buildResult;
  console.log(`✅ ${buildResult.name}: ${buildResult.avgMs.toFixed(2)}ms`);

  // Text normalization
  console.log('\n📝 Text normalization benchmarks...');
  const textResults = benchmarkTextNormalization();
  textResults.forEach((result) => {
    results.benchmarks[result.name] = result;
    console.log(`  ${result.name}: ${result.avgMs.toFixed(3)}ms (${result.opsPerSec} ops/sec)`);
  });

  // PDF generation
  console.log('\n📄 PDF generation benchmarks...');
  const pdfResult = benchmarkPDFGeneration();
  results.benchmarks[pdfResult.name] = pdfResult;
  console.log(`  ${pdfResult.name}: ${pdfResult.avgMs.toFixed(3)}ms (${pdfResult.opsPerSec} ops/sec)`);

  return results;
}

/**
 * Save baseline
 */
function saveBaseline(results) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2));
  console.log(`\n💾 Baseline saved to: ${BASELINE_PATH}`);
}

/**
 * Load baseline
 */
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`Baseline not found at ${BASELINE_PATH}. Run with --save first.`);
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
}

/**
 * Compare results to baseline
 */
function compareToBaseline(current, baseline) {
  console.log('\n📊 Comparison to baseline:\n');

  const THRESHOLD = 0.10; // 10% threshold
  let hasRegression = false;
  const comparisons = [];

  Object.keys(current.benchmarks).forEach((name) => {
    const currentBench = current.benchmarks[name];
    const baselineBench = baseline.benchmarks[name];

    if (!baselineBench) {
      console.log(`  ⚠️  ${name}: NEW (no baseline)`);
      return;
    }

    const diff = currentBench.avgMs - baselineBench.avgMs;
    const diffPercent = (diff / baselineBench.avgMs) * 100;
    const isSlower = diffPercent > THRESHOLD * 100;

    if (isSlower) {
      hasRegression = true;
    }

    const icon = isSlower ? '🔴' : diffPercent < -5 ? '🟢' : '⚪';
    const sign = diff > 0 ? '+' : '';

    console.log(
      `  ${icon} ${name}:\n` +
      `      Baseline: ${baselineBench.avgMs.toFixed(3)}ms\n` +
      `      Current:  ${currentBench.avgMs.toFixed(3)}ms\n` +
      `      Diff:     ${sign}${diff.toFixed(3)}ms (${sign}${diffPercent.toFixed(1)}%)`
    );

    comparisons.push({
      name,
      baseline: baselineBench.avgMs,
      current: currentBench.avgMs,
      diff,
      diffPercent,
      isRegression: isSlower,
    });
  });

  console.log('\n' + '='.repeat(60));

  if (hasRegression) {
    console.log('❌ PERFORMANCE REGRESSION DETECTED (>10% slower)');
    console.log('\nRegressed benchmarks:');
    comparisons
      .filter((c) => c.isRegression)
      .forEach((c) => {
        console.log(`  - ${c.name}: +${c.diffPercent.toFixed(1)}% slower`);
      });
    process.exit(1);
  } else {
    console.log('✅ All benchmarks within acceptable range');
    const improvements = comparisons.filter((c) => c.diffPercent < -5);
    if (improvements.length > 0) {
      console.log('\n🎉 Performance improvements:');
      improvements.forEach((c) => {
        console.log(`  - ${c.name}: ${c.diffPercent.toFixed(1)}% faster`);
      });
    }
    process.exit(0);
  }
}

/**
 * Format results for display
 */
function displayResults(results) {
  console.log('\n' + '='.repeat(60));
  console.log('📈 Benchmark Results Summary');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${results.timestamp}`);
  console.log(`Platform:  ${results.system.platform} ${results.system.arch}`);
  console.log(`Node:      ${results.system.nodeVersion}`);
  console.log(`CPU:       ${results.system.cpus}`);
  console.log('='.repeat(60));
}

/**
 * Main
 */
function main() {
  const args = process.argv.slice(2);
  const shouldSave = args.includes('--save');
  const shouldCompare = args.includes('--compare');

  try {
    const results = runBenchmarks();
    displayResults(results);

    if (shouldSave) {
      saveBaseline(results);
    }

    if (shouldCompare) {
      const baseline = loadBaseline();
      compareToBaseline(results, baseline);
    } else if (!shouldSave) {
      console.log('\n💡 Tip: Use --save to save baseline, --compare to compare against it');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
