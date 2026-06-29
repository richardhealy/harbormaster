// @octokit/app and @octokit/webhooks are pure-ESM packages mapped to CJS mocks
// via jest.config.js moduleNameMapper so they work in the Jest/CommonJS environment.
import { GitHubApp } from '../../../src/integrations/github/app';

const DUMMY_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA2a2r\n-----END RSA PRIVATE KEY-----';

describe('GitHubApp', () => {
  test('constructs with valid config', () => {
    const ghApp = new GitHubApp({
      appId: '12345',
      privateKey: DUMMY_KEY,
      webhookSecret: 'secret',
    });
    expect(ghApp).toBeDefined();
    expect(ghApp.webhooks).toBeDefined();
  });

  test('webhooks object exposes on and receive', () => {
    const ghApp = new GitHubApp({
      appId: '99',
      privateKey: DUMMY_KEY,
      webhookSecret: 'test-secret',
    });
    expect(typeof ghApp.webhooks.on).toBe('function');
    expect(typeof ghApp.webhooks.receive).toBe('function');
  });

  test('registerProtectedBranchEnforcement does not throw', () => {
    const ghApp = new GitHubApp({
      appId: '99',
      privateKey: DUMMY_KEY,
      webhookSecret: 'test-secret',
    });
    expect(() => ghApp.registerProtectedBranchEnforcement()).not.toThrow();
  });
});
