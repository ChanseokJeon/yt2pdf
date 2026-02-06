# Contract Tests

## What are Contract Tests?

Contract tests verify the **agreement** (contract) between a consumer (client) and a provider (API/service). They ensure both sides honor the agreed-upon interface without full integration testing.

These tests are lighter than integration tests but more robust than unit tests, making them ideal for testing APIs, external services, and module boundaries.

## When to Use

- Testing API endpoints (REST, GraphQL)
- External service integrations (YouTube API, OpenAI API)
- Module boundaries and interfaces
- Third-party library usage
- Event-driven systems
- Preventing breaking changes across modules

## How It Works

1. **Define Contract** - Document the agreed interface (request/response format, behavior)
2. **Provider Tests** - Verify the provider (API) implements the contract
3. **Consumer Tests** - Verify the consumer correctly uses the contract
4. **Independent Testing** - Each side tested independently, preventing tight coupling

## Example Test

```typescript
// Consumer: PDF Generator using YouTube API
describe('Contract: YouTube API Consumer', () => {
  it('correctly formats video request', () => {
    const request = buildYouTubeRequest(videoId);
    expect(request).toMatchContract('youtube-api-request');
  });

  it('handles YouTube captions response', () => {
    const response = {
      items: [{ id: 'vid', snippet: { title: 'Title' } }]
    };
    const result = parseYouTubeCaptions(response);
    expect(result).toHaveProperty('captions');
  });
});

// Provider: YouTube API mock
describe('Contract: YouTube API Provider', () => {
  it('returns captions in expected format', async () => {
    const response = await youtubeApi.getVideoInfo(videoId);
    expect(response).toMatchSchema(youtubeVideoSchema);
  });
});
```

## Running Contract Tests

```bash
# Run all contract tests
npm test -- tests/contracts

# Run consumer contracts only
npm test -- tests/contracts -t "Consumer"

# Run provider contracts only
npm test -- tests/contracts -t "Provider"

# Validate all contracts are defined
npm test -- tests/contracts --validate-contracts
```

## Tips

- Use schema validation libraries (Joi, Yup, Zod)
- Keep contracts separate from implementation
- Document why contracts exist in comments
- Version contracts when APIs change
- Use pact files for distributed system contracts
- Update contracts consciously, never blindly
- Consider using contract testing tools like Pact.js for microservices
