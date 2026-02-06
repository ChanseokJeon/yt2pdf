# Golden Master Tests

## What are Golden Master Tests?

Golden master testing captures complete, complex outputs from a system and compares them to "golden" reference files. Instead of asserting specific details, you assert that the entire output matches a stored baseline.

This is powerful for systems with complex, multi-part outputs where listing all assertions would be impractical.

## When to Use

- PDF generation and validation (full document comparison)
- Complex data transformations with many fields
- Output that has many interdependent properties
- Visual regression testing (comparing generated images)
- Batch processing results
- When the "correctness" is holistic, not just component-level

## How It Works

1. **Generate** - Run the system and capture its full output
2. **Store as Golden** - Save this output as the reference (golden master file)
3. **Compare** - On future runs, compare new output to golden master
4. **Review Diffs** - When diff occurs, review if change is intentional or a bug
5. **Update** - If intentional, update the golden master; if bug, fix the code

## Example Test

```typescript
// Compares generated PDF against golden master file
describe('Golden Master: PDF Output', () => {
  it('generates PDF matching golden master', async () => {
    const pdf = await generatePdf(testVideo);

    // Compare full PDF content to stored golden master
    expect(pdf).toMatchGoldenMaster('video-interview-1hour.pdf');
  });

  it('YouTube thumbnail extraction matches golden', async () => {
    const images = await extractThumbnails(testVideo);
    expect(images).toMatchGoldenMaster('thumbnails-frame-30.json');
  });
});
```

## Running Golden Master Tests

```bash
# Run all golden master tests
npm test -- tests/golden-master

# Generate new golden masters (use cautiously!)
npm test -- tests/golden-master --update-golden

# Review diffs for failing golden master tests
npm test -- tests/golden-master --diff

# Compare specific test output
npm test -- tests/golden-master -t "PDF Output"
```

## Tips

- Store golden master files in version control (git)
- Keep golden master files reasonably sized (compress large PDFs)
- Always review diffs carefully before updating golden masters
- Use for end-to-end tests, not for every small function
- Combine with characterization tests for better coverage
- Use `--diff` flag to inspect what changed before approving
