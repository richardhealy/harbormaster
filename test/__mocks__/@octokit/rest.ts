export class Octokit {
  checks = {
    create: jest.fn().mockResolvedValue({ data: { id: 1 } }),
  };
  constructor(_opts?: Record<string, unknown>) {}
}
