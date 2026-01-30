#!/usr/bin/env npx tsx
/**
 * AI 출력 검증 스크립트
 * PDF 변환 전에 AI 추출 결과를 검증하기 위한 도구
 */

import * as fs from 'fs';
import * as path from 'path';

const CACHE_DIR = path.join(process.env.HOME || '', '.cache/yt2pdf/ai');

interface MainInformation {
  paragraphs: string[];
  bullets: string[];
}

interface EnhancedSection {
  oneLiner: string;
  keyPoints: string[];
  mainInformation: MainInformation;
  translatedText: string;
  notableQuotes: Array<{ text: string; speaker?: string }>;
}

interface CacheData {
  result: {
    sections: Record<string, EnhancedSection>;
  };
  createdAt: number;
}

function analyzeSection(timestamp: string, section: EnhancedSection): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📍 섹션: ${timestamp}초`);
  console.log(`${'═'.repeat(60)}`);

  // 1. oneLiner
  console.log(`\n💡 한줄 요약: ${section.oneLiner}`);

  // 2. keyPoints
  console.log(`\n🔑 핵심 포인트 (${section.keyPoints.length}개):`);
  section.keyPoints.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));

  // 3. mainInformation 분석
  console.log(`\n📋 주요 정보:`);

  // Paragraphs
  console.log(`   📝 문단 (${section.mainInformation.paragraphs.length}개):`);
  section.mainInformation.paragraphs.forEach((p, i) => {
    console.log(`      [${i + 1}] ${p.substring(0, 100)}${p.length > 100 ? '...' : ''}`);
    console.log(`          (${p.length}자)`);
  });

  // Bullets with tag analysis
  console.log(`\n   📌 불릿 (${section.mainInformation.bullets.length}개):`);
  const tagCounts: Record<string, number> = {};
  section.mainInformation.bullets.forEach((b, i) => {
    // Extract tag
    const tagMatch = b.match(/^\[([A-Z]+)\]/);
    const tag = tagMatch ? tagMatch[1] : 'NO_TAG';
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    console.log(`      ${i + 1}. ${b}`);
  });

  // Tag statistics
  console.log(`\n   📊 태그 분포:`);
  Object.entries(tagCounts).forEach(([tag, count]) => {
    const status = tag === 'NO_TAG' ? '⚠️' : '✅';
    console.log(`      ${status} [${tag}]: ${count}개`);
  });

  // 4. translatedText (preview)
  console.log(`\n📖 번역문 미리보기:`);
  console.log(`   "${section.translatedText.substring(0, 150)}..."`);
  console.log(`   (전체 ${section.translatedText.length}자)`);

  // 5. Quotes
  if (section.notableQuotes && section.notableQuotes.length > 0) {
    console.log(`\n💬 인용 (${section.notableQuotes.length}개):`);
    section.notableQuotes.forEach((q, i) => {
      console.log(`   ${i + 1}. "${q.text}" - ${q.speaker || '화자'}`);
    });
  }

  // 6. Quality checks
  console.log(`\n🔍 품질 검사:`);

  // Check: Are bullets tagged?
  const untaggedBullets = section.mainInformation.bullets.filter(b => !b.match(/^\[/));
  if (untaggedBullets.length > 0) {
    console.log(`   ⚠️ 태그 없는 불릿: ${untaggedBullets.length}개`);
  } else {
    console.log(`   ✅ 모든 불릿에 태그 있음`);
  }

  // Check: Paragraph vs Translation overlap
  const transWords = new Set(section.translatedText.split(/\s+/).filter(w => w.length > 2));
  section.mainInformation.paragraphs.forEach((para, i) => {
    const paraWords = para.split(/\s+/).filter(w => w.length > 2);
    const overlap = paraWords.filter(w => transWords.has(w)).length;
    const ratio = paraWords.length > 0 ? Math.round((overlap / paraWords.length) * 100) : 0;
    const status = ratio > 70 ? '⚠️' : '✅';
    console.log(`   ${status} 문단${i + 1} 번역 중복률: ${ratio}% ${ratio > 70 ? '(높음!)' : ''}`);
  });
}

function main(): void {
  const videoId = process.argv[2];

  if (!videoId) {
    console.log('사용법: npx tsx scripts/verify-ai-output.ts <videoId>');
    console.log('예시: npx tsx scripts/verify-ai-output.ts MGzymaYBiss');
    console.log('\n사용 가능한 캐시 파일:');

    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
      files.forEach(f => {
        const id = f.split('_')[0];
        console.log(`  - ${id}`);
      });
    }
    process.exit(1);
  }

  // Find cache file
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(videoId) && f.endsWith('.json'));

  if (files.length === 0) {
    console.error(`❌ 캐시 파일을 찾을 수 없음: ${videoId}`);
    process.exit(1);
  }

  const cacheFile = path.join(CACHE_DIR, files[0]);
  console.log(`📁 캐시 파일: ${cacheFile}`);

  const data: CacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  const sections = data.result.sections;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎬 AI 출력 검증 리포트`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`📅 생성일: ${new Date(data.createdAt).toLocaleString()}`);
  console.log(`📊 섹션 수: ${Object.keys(sections).length}개`);

  // Analyze each section
  Object.entries(sections)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([ts, section]) => analyzeSection(ts, section));

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 전체 요약`);
  console.log(`${'═'.repeat(60)}`);

  let totalBullets = 0;
  let taggedBullets = 0;
  let totalParagraphs = 0;
  const allTags: Record<string, number> = {};

  Object.values(sections).forEach(section => {
    totalParagraphs += section.mainInformation.paragraphs.length;
    section.mainInformation.bullets.forEach(b => {
      totalBullets++;
      const tagMatch = b.match(/^\[([A-Z]+)\]/);
      if (tagMatch) {
        taggedBullets++;
        const tag = tagMatch[1];
        allTags[tag] = (allTags[tag] || 0) + 1;
      }
    });
  });

  console.log(`\n📌 불릿 통계:`);
  console.log(`   총 불릿: ${totalBullets}개`);
  console.log(`   태그 있음: ${taggedBullets}개 (${Math.round(taggedBullets / totalBullets * 100)}%)`);

  console.log(`\n📊 태그별 분포:`);
  Object.entries(allTags)
    .sort(([, a], [, b]) => b - a)
    .forEach(([tag, count]) => {
      console.log(`   [${tag}]: ${count}개`);
    });

  console.log(`\n📝 문단 통계:`);
  console.log(`   총 문단: ${totalParagraphs}개`);
  console.log(`   섹션당 평균: ${(totalParagraphs / Object.keys(sections).length).toFixed(1)}개`);

  console.log(`\n✅ 검증 완료`);
}

main();
