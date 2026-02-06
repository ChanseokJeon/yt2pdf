# Characterization Tests

## What are Characterization Tests?

Characterization tests capture the **current behavior** of a system without making judgments about whether that behavior is correct. They document "what the code does right now" as a baseline, enabling safe refactoring and change detection.

Also called "baseline tests" or "document-behavior tests", these tests are particularly useful for legacy code or when requirements are unclear.

## When to Use

- Refactoring existing code safely
- Understanding unclear or undocumented system behavior
- Creating a behavior baseline before major changes
- Detecting regressions when behavior should not change
- Working with legacy code without clear specifications

## How It Works

1. **Observe** - Run the system and record outputs
2. **Capture** - Document the exact current behavior as test assertions
3. **Protect** - Use these tests to catch unexpected changes during refactoring
4. **Approve** - When you intentionally change behavior, update tests consciously

## Example Test

```typescript
// Captures current PDF generation behavior
describe('Characterization: PDF Generation', () => {
  it('generates PDF with title from video metadata', async () => {
    const pdf = await generatePdf(testVideo);
    expect(pdf.title).toMatch(/Interview with Expert/);
  });

  it('includes exactly 60 screenshots per hour', async () => {
    const pdf = await generatePdf(testVideoOneHour);
    expect(pdf.screenshotCount).toBe(60);
  });
});
```

## Running Characterization Tests

```bash
# Run all characterization tests
npm test -- tests/characterization

# Run with detailed output
npm test -- tests/characterization --verbose

# Update snapshots after intentional behavior changes
npm test -- tests/characterization -u
```

## Tips

- Document WHY a behavior exists in comments
- Use snapshots for complex output structures
- Keep tests focused on observable behavior, not implementation
- When updating tests, explicitly note why behavior changed
