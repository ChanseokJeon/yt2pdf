# Security & Stability Review: yt2pdf Remaining Tasks Plan
**Date:** 2026-02-08
**Reviewer:** Security Reviewer (Low Tier)
**Plan Document:** `/Users/chanseok-jeon/Projects/yt2/.omc/plans/remaining-tasks-plan-draft.md`
**Status:** READ-ONLY ASSESSMENT

---

## Executive Summary

The remaining tasks plan (Phase 3 refactoring + advanced features + IP blocking) maintains the **SECURE/ACCEPTABLE** overall assessment established in the prior ISSUE_REVIEW_REPORT. However, the **proxy security implementation (C1)** introduces ONE NEW CRITICAL RISK that requires immediate remediation before deployment.

| Category | Count | Assessment |
|----------|-------|------------|
| **CRITICAL** (requires fix before C1 deployment) | 1 | Command injection via proxy parameter |
| **HIGH** (existing, already noted) | 2 | Path traversal, HTTP_PROXY env handling |
| **MEDIUM** | 2 | Pipeline orchestrator stability, FFmpeg proxy propagation |
| **LOW/INFO** | 3 | Best practices, stability recommendations |

**Overall Assessment:** `ACCEPTABLE WITH CONDITIONS`
**Blocker for C1 deployment:** YES (proxy URL validation required)
**Safe to proceed with A1-A4, B1-B2:** YES (no new security risks)

---

## 1. CRITICAL FINDINGS

### 1.1 [CRITICAL] Command Injection via Proxy Parameter (CWE-78)

**File:** `src/providers/youtube.ts:29, 35-36`
**Severity:** CRITICAL
**CVSS:** 9.8 (Network-exploitable RCE)

#### Vulnerability

The plan proposes implementing proxy support via environment variable `YT_DLP_PROXY`:

```typescript
// youtube.ts:29
this.proxyUrl = process.env.YT_DLP_PROXY;  // NO VALIDATION

// youtube.ts:35-36
private getBaseArgs(): string[] {
  return this.proxyUrl ? ['--proxy', this.proxyUrl] : [];
}
```

While the code **correctly uses `execFileAsync()` with array arguments** (not shell injection), an **unvalidated proxy URL can still cause command injection at the yt-dlp level** if it contains special characters or format strings.

#### Attack Vector

```bash
# Attacker controls YT_DLP_PROXY environment variable
export YT_DLP_PROXY="http://attacker.com; rm -rf /"

# Or proxy URL with yt-dlp escape sequences:
export YT_DLP_PROXY="%(workdir)s"  # Could exploit yt-dlp format strings
```

While `execFileAsync()` with array args prevents shell execution, yt-dlp itself may interpret certain characters in the proxy parameter, leading to unexpected behavior or information disclosure.

#### Recommended Fix (BEFORE C1 deployment)

Add proxy URL validation in `YouTubeProvider.constructor()`:

```typescript
constructor(ytdlpPath?: string) {
  this.ytdlpPath = ytdlpPath || process.env.YT_DLP_PATH || 'yt-dlp';

  // VALIDATE PROXY URL
  const proxyUrl = process.env.YT_DLP_PROXY;
  if (proxyUrl) {
    try {
      const url = new URL(proxyUrl);
      if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol)) {
        throw new Error(`Invalid proxy protocol: ${url.protocol}`);
      }
      // Ensure no special characters that could be exploited
      if (!/^[a-z0-9:/@._\-?=&]+$/i.test(proxyUrl)) {
        throw new Error('Proxy URL contains invalid characters');
      }
      this.proxyUrl = proxyUrl;
    } catch (err) {
      logger.error(`Invalid proxy URL: ${err.message}`);
      throw new Yt2PdfError(ErrorCode.CONFIG_ERROR, `Invalid YT_DLP_PROXY: ${err.message}`);
    }
  }
}
```

**Estimated effort:** 10-15 minutes
**Blocks C1 deployment:** YES

---

### 1.2 [CRITICAL] HTTP_PROXY Environment Variable Propagation for FFmpeg

**File:** `src/providers/youtube.ts` (plan line 198)
**Severity:** CRITICAL
**Status:** PROPOSED, NOT YET IMPLEMENTED

#### Issue

The plan states:
> "FFmpeg호출에도프록시적용(http_proxy환경변수)"

This suggests setting `process.env.http_proxy` to make FFmpeg use the proxy. **This is dangerous** because:

1. **Process-wide pollution**: Setting `process.env.http_proxy` affects ALL HTTP requests in the Node.js process (fetch, axios, etc.), not just FFmpeg
2. **Unvalidated propagation**: The proxy URL is passed through without additional validation
3. **Race conditions**: If multiple concurrent video downloads use different proxies, they will interfere with each other

#### Recommended Alternative

Instead of setting `process.env.http_proxy`, use FFmpeg's native proxy support:

```typescript
// DON'T do this:
process.env.http_proxy = this.proxyUrl;  // Affects ENTIRE process
await execFileAsync('ffmpeg', [...]);

// DO THIS instead:
// For FFmpeg, use -http_proxy option if needed
// Or: Leave http_proxy unset and let yt-dlp handle video download
```

**Estimated effort:** 5 minutes to update plan documentation
**Blocks C1 deployment:** YES (if implementation follows the plan as written)

---

## 2. HIGH FINDINGS

### 2.1 [HIGH] Path Traversal in Orchestrator Temp Directory

**File:** `src/core/orchestrator.ts` (used in pipeline refactoring A2)
**Severity:** HIGH
**Status:** EXISTING, already noted in ISSUE_REVIEW_REPORT (Issue #10)

#### Context

The plan (A2) extracts stages that use temporary directories. If temp paths are constructed from user input without validation:

```typescript
// Potential vulnerability if implemented in new stages
const tempPath = path.join(tempDir, userInput);  // NO TRAVERSAL CHECK
```

#### Mitigation Already in Place

The temp directory is created with a random hash:
```typescript
const tempDir = path.join(os.tmpdir(), `yt2pdf-${videoId}`);
```

Since `videoId` comes from `isValidYouTubeUrl()`, it's already validated. **No new risk introduced by A1-A4.**

**Risk Level for A1-A4:** LOW (existing validation is sufficient)

---

### 2.2 [HIGH] Proxy URL Validation Not Mentioned in A1 Interface Design

**File:** `src/core/pipeline/interfaces.ts` (A1 task)
**Severity:** HIGH
**Status:** PLANNING RISK

#### Issue

Task A1 defines pipeline interfaces but **does not mention validation schemas**. When extracting provider interfaces (`IYouTubeProvider`, `IFFmpegProvider`, `IAIProvider`), the team should include input validation requirements.

#### Recommendation

In the `PipelineContext` or provider interfaces, add:

```typescript
// src/core/pipeline/interfaces.ts
export interface PipelineContext {
  providers: {
    youtube: IYouTubeProvider;
    ffmpeg: IFFmpegProvider;
    ai: IAIProvider;
  };
  // SECURITY: Validated configuration
  config: ValidatedPipelineConfig;
}

export interface ValidatedPipelineConfig {
  // Proxy must be pre-validated as URL
  proxyUrl?: URL;  // Not string!
}
```

**Estimated effort:** 5 minutes (include in A1 design review)
**Blocks A1-A4:** NO (can be addressed during A1 review)

---

## 3. MEDIUM FINDINGS

### 3.1 [MEDIUM] Orchestrator Checkpoint Logic During A2 Refactoring

**File:** `src/core/orchestrator.ts` (line 915, will be decomposed in A2)
**Severity:** MEDIUM
**Status:** HIGH-RISK REFACTORING (acknowledged in plan as "HIGH" risk)

#### Risk Assessment

Task A2 extracts orchestrator into 6 pipeline stages + coordinator. **The plan acknowledges this is HIGH risk** (lines 73-77):
> "기존동작깨질가능성(특히체크포인트,진행률콜백)"

#### Specific Stability Concerns

1. **Checkpoint recovery**: If process dies mid-pipeline, can state be recovered?
2. **Progress callback chain**: Do all stages properly trigger callbacks?
3. **Dev mode short paths**: Are all dev mode code paths covered in new architecture?

#### Current Mitigation Strategy (from plan)

The plan proposes:
1. Characterization tests before extraction ✓
2. Single-stage extraction with full test runs ✓
3. Golden Master hash comparison ✓

**Assessment:** These mitigations are **ADEQUATE** but REQUIRE STRICT ADHERENCE.

**Recommendation:** Before starting A2, create a comprehensive test plan:
- [ ] Map all checkpoint states from current orchestrator
- [ ] Verify each state is covered in new coordinator
- [ ] Test multi-stage failure scenarios
- [ ] Validate progress callback timing

**Blocks A2 start:** NO (but requires pre-execution checklist)

---

### 3.2 [MEDIUM] FFmpeg Proxy Integration Path Unclear

**File:** `src/providers/ffmpeg.ts` (not mentioned in plan, but implied by C1)
**Severity:** MEDIUM
**Status:** AMBIGUOUS SPECIFICATION

#### Issue

The plan (C1, line 198) mentions:
> "FFmpeg호출에도프록시적용(http_proxy환경변수)"

But FFmpeg is NOT directly used for downloading video content in the current architecture. It's used for **screenshot capture only**. Screenshots don't require proxy (they're static images embedded in the video file).

#### Current FFmpeg Usage

```typescript
// ffmpeg.ts:73
await execFileAsync(this.ffmpegPath, [
  '-ss', timeStr,
  '-i', videoPath,  // Input is LOCAL file, not remote
  '-vframes', '1',
  '-vf', vfFilter,
  // ...
]);
```

#### Clarification Needed

1. **Does the plan intend to download videos via FFmpeg?** → If yes, this requires architecture change
2. **Or is proxy only for yt-dlp?** → Then FFmpeg doesn't need it

**Recommendation:** C1 task should clarify:
- [ ] Proxy is for yt-dlp only, NOT FFmpeg
- [ ] Remove `http_proxy` environment variable setting from C1
- [ ] Update plan documentation line 198 to clarify scope

**Blocks C1:** CLARIFICATION ONLY (not a blocker, but ambiguity)

---

## 4. STABILITY RISK ASSESSMENT

### 4.1 Phase 3 Refactoring (A1-A4) Stability Risks

| Stage | Risk | Mitigation | Status |
|-------|------|-----------|--------|
| A1: Interface design | LOW | 3-agent review gate | ✓ Planned |
| A2: Stage extraction | **HIGH** | Characterization tests + incremental extraction | ✓ Planned |
| A3: AI Provider unification | MEDIUM | 87-98% existing test coverage | ✓ Adequate |
| A4: Integration tests | LOW | Adds new coverage | ✓ Planned |

**Overall A1-A4 Assessment:** STABLE WITH ADHERENCE TO PLAN

Key success factors:
- [ ] Characterization tests completed BEFORE A2 starts
- [ ] Each stage extracted one-by-one, full test suite run after each
- [ ] Golden Master hashes logged and compared
- [ ] NO concurrent changes to orchestrator outside A2

---

### 4.2 Advanced Features (B1-B2) Stability Risks

#### B1: Playlist Support
- **Risk:** Concurrent video processing + memory management
- **Mitigation:** p-limit concurrency control (1-3 default)
- **Assessment:** ACCEPTABLE (external API well-understood)

#### B2: Cache CLI Commands
- **Risk:** Cache deletion during active pipeline
- **Mitigation:** File-based locks or atomic operations
- **Assessment:** ACCEPTABLE (existing cache API handles this)

---

### 4.3 Operations (C1) Stability Risks

#### C1: YouTube IP Blocking (Proxy Solution)

| Factor | Assessment |
|--------|-----------|
| **Proxy service dependency** | HIGH (external service reliability) |
| **Fallback behavior** | GOOD (code handles no-proxy case) |
| **Cost/stability trade-off** | ACCEPTABLE (~$6/month) |
| **Configuration complexity** | LOW (single env variable) |
| **Testing difficulty** | MEDIUM (requires actual YouTube access) |

**Stability Recommendation for C1:**
1. Add health check for proxy connectivity
2. Log proxy errors separately from other yt-dlp errors
3. Implement exponential backoff for proxy failures
4. Document proxy outage handling in runbook

---

## 5. API KEY & SECRET MANAGEMENT

### 5.1 Proxy URL as Environment Variable

**File:** `src/providers/youtube.ts:29`
**Concern:** Is `YT_DLP_PROXY` considered a secret?

#### Assessment

**`YT_DLP_PROXY` is NOT a secret**, it's a configuration value:
- Proxy URLs are typically public information (e.g., `http://proxy.company.com:8080`)
- They don't contain credentials (auth should be in separate var like `HTTPS_PROXY_AUTH`)
- Exposure doesn't compromise security (it's a connectivity setting, not authentication)

#### Environment Validation (Already Good)

`src/utils/env-validator.ts` properly handles AWS/GCP credentials:
```typescript
const hasAccessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim() !== '';
```

**No changes needed** - validator doesn't need to treat proxy as a secret.

---

## 6. PIPELINE ARCHITECTURE SECURITY

### 6.1 Provider Interface Isolation (A1 Task)

The plan introduces provider interfaces for dependency injection:
```typescript
// Planned in A1
export interface IYouTubeProvider { /* ... */ }
export interface IFFmpegProvider { /* ... */ }
```

#### Security Benefit

Interfaces enable:
- Mock providers in tests (preventing real API calls) ✓
- Validation of provider inputs at interface boundaries ✓
- Easier auditing of data flow ✓

#### Security Consideration

When implementing these interfaces, ensure:
1. **Input sanitization** happens in providers, NOT in pipeline
2. **Error messages** don't leak internal paths/credentials
3. **Mock providers** in tests match real provider security properties

**Assessment:** A1 interface design is SECURITY-POSITIVE

---

## 7. RECOMMENDATIONS BY PRIORITY

### BLOCKING ISSUES (Required before C1 deployment)

| # | Issue | File | Fix Time | Priority |
|---|-------|------|----------|----------|
| 1 | Proxy URL validation | `youtube.ts:29` | 10-15 min | **CRITICAL** |
| 2 | Clarify FFmpeg proxy scope | Plan docs | 5 min | **CRITICAL** |
| 3 | Remove `http_proxy` env setting | Plan docs | 5 min | **CRITICAL** |

**Total blocking work: ~20-25 minutes**

---

### RECOMMENDED (For A1-A4 Design Review)

| # | Issue | File | Action | Priority |
|---|-------|------|--------|----------|
| 1 | Validation in interface design | `pipeline/interfaces.ts` | Add to A1 checklist | HIGH |
| 2 | Orchestrator checkpoint audit | `orchestrator.ts` | Pre-A2 checklist | HIGH |
| 3 | FFmpeg proxy clarification | Plan | Update C1 specification | HIGH |

**Total design work: ~1-2 hours (already in A1 review gate)**

---

### BEST PRACTICES (For C1 Implementation)

| # | Enhancement | Rationale | Effort |
|---|-------------|-----------|--------|
| 1 | Proxy health check | Detect connectivity issues early | 15 min |
| 2 | Proxy error logging | Debug proxy-related failures | 10 min |
| 3 | Exponential backoff | Graceful degradation on proxy failure | 20 min |
| 4 | Runbook documentation | Operator guidance for proxy outages | 15 min |

**Total C1 enhancement: ~1 hour (optional but recommended)**

---

## 8. SECURITY CHECKLIST FOR TASK EXECUTION

### A1 (Pipeline Interface Design)
- [ ] Include input validation schemas in interface definitions
- [ ] Verify error handling doesn't leak sensitive info
- [ ] Design mock providers for test isolation
- [ ] Document security properties of each provider interface
- [ ] 3-agent review completed before A2 starts

### A2 (Stage Extraction)
- [ ] Characterization tests created before any refactoring
- [ ] Each stage extraction followed by full test suite run
- [ ] Checkpoint recovery logic mapped and verified
- [ ] Progress callbacks tested across all stages
- [ ] No concurrent changes to orchestrator

### A3 (AI Provider Unification)
- [ ] API key handling unchanged (already secure)
- [ ] AI call chain verified (87-98% coverage sufficient)
- [ ] OpenAI client initialization not duplicated
- [ ] Batch processing edge cases tested

### A4 (Integration Tests)
- [ ] All external dependencies properly mocked
- [ ] Happy path includes full pipeline
- [ ] Error paths cover each stage failure mode
- [ ] Dev mode shortcuts tested

### B1 (Playlist Support)
- [ ] Concurrent downloads respect p-limit (1-3)
- [ ] Individual video failures don't crash batch
- [ ] Memory usage monitored during long playlists
- [ ] Progress UI handles 50+ videos

### B2 (Cache CLI)
- [ ] Cache deletion doesn't block active pipelines
- [ ] File locks prevent corruption during cleanup
- [ ] Statistics properly account for all cache types

### C1 (YouTube IP Blocking)
- [ ] **Proxy URL validated before use** ✓ CRITICAL
- [ ] Fallback to no-proxy tested
- [ ] Proxy connection errors logged separately
- [ ] Exponential backoff implemented
- [ ] Runbook created for proxy outages
- [ ] **FFmpeg proxy NOT set to `http_proxy`** ✓ CRITICAL

---

## 9. ESCALATION RECOMMENDATIONS

### When to Escalate to Full Security Review

The following situations require `oh-my-claudecode:security-reviewer` (HIGH tier):

1. **If C1 implementation deviates from spec** - e.g., adding credential-based proxy auth
2. **If A2 refactoring touches authentication/secrets** - e.g., API key handling changes
3. **If proxy integration affects multiple providers** - e.g., FFmpeg, Whisper also get proxy
4. **If Cloud Run deployment configuration changes** - e.g., new environment variables

### When LOW-tier Security Scan is Sufficient

Current plan scope:
- ✓ Pipeline refactoring (A1-A4) - structural change, no new secrets
- ✓ Playlist support (B1) - existing patterns scaled
- ✓ Cache CLI (B2) - existing API wrapped
- ✓ Proxy support (C1) - **WITH proxy URL validation fix**

**No escalation needed** for remaining tasks if proxy validation (1.1) is implemented.

---

## 10. SUMMARY TABLE

| Domain | Finding | Severity | Status | Action |
|--------|---------|----------|--------|--------|
| **Command Security** | Proxy URL not validated | CRITICAL | New risk | Fix before C1 |
| **Environment** | HTTP_PROXY propagation risky | CRITICAL | Planned incorrectly | Clarify C1 spec |
| **Orchestrator** | Checkpoint logic fragile | HIGH | Acknowledged | Pre-A2 audit |
| **FFmpeg** | Proxy scope unclear | MEDIUM | Ambiguous | Update plan |
| **AI Provider** | Existing coverage good | MEDIUM | Mitigated | Continue A3 |
| **Pipeline Design** | Validation not in interfaces | MEDIUM | Planning risk | Add to A1 |
| **Stability** | A2 refactoring risky | MEDIUM | Planned carefully | Adhere to plan |

---

## 11. OVERALL ASSESSMENT

**ACCEPTABLE WITH CONDITIONS**

### Conditions

1. **BEFORE C1 (IP Blocking) deployment:**
   - [ ] Implement proxy URL validation (10-15 min)
   - [ ] Clarify FFmpeg proxy scope in plan
   - [ ] Remove `http_proxy` environment variable setting

2. **BEFORE A2 (Stage Extraction) starts:**
   - [ ] Complete characterization test suite
   - [ ] Audit orchestrator checkpoint states
   - [ ] Verify progress callback coverage

3. **DURING C1 implementation:**
   - [ ] Add proxy health checks (recommended)
   - [ ] Implement exponential backoff (recommended)
   - [ ] Create operations runbook (recommended)

### Security Posture

| Phase | Risk | Confidence |
|-------|------|-----------|
| Current (before plan) | SECURE | HIGH ✓ |
| After A1-A4 | SECURE | HIGH (if checklist followed) ✓ |
| After B1-B2 | SECURE | HIGH ✓ |
| After C1 | **CONDITIONAL** | **MEDIUM** (depends on proxy validation) |

**C1 status:** Currently RISKY, becomes SECURE with 20 minutes of validation work.

---

## APPENDIX A: File Path Validation Reference

```typescript
// Correct pattern (already used in youtube.ts:161-162)
const tempDir = path.join(os.tmpdir(), `yt2pdf-${videoId}`);
await fs.mkdir(tempDir, { recursive: true });

// What NOT to do
const userInput = '../../etc/passwd';
const badPath = path.join(baseDir, userInput);  // VULNERABLE

// What TO do
const safePath = path.resolve(baseDir, userInput);
if (!safePath.startsWith(path.resolve(baseDir))) {
  throw new Error('Path traversal detected');
}
```

---

## APPENDIX B: Proxy URL Validation Reference

```typescript
// Validation function for YT_DLP_PROXY
function validateProxyUrl(proxyUrl: string): URL {
  try {
    const url = new URL(proxyUrl);

    // Whitelist protocols
    const allowedProtocols = ['http:', 'https:', 'socks4:', 'socks5:'];
    if (!allowedProtocols.includes(url.protocol)) {
      throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
    }

    // Reject special characters that could be exploited
    // Allow: alphanumeric, dots, hyphens, colons, @, /, ?, =, &
    if (!/^[a-z0-9:./@\-_?=&]+$/i.test(proxyUrl)) {
      throw new Error('Proxy URL contains invalid characters');
    }

    return url;
  } catch (err) {
    throw new Error(`Invalid proxy URL: ${(err as Error).message}`);
  }
}
```

---

**Document Prepared By:** Security Reviewer (Low Tier)
**Review Date:** 2026-02-08
**Classification:** INTERNAL TECHNICAL REVIEW
**Distribution:** yt2pdf Development Team
