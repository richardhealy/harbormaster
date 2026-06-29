jest.mock('simple-git');

import simpleGit from 'simple-git';
import { ReleaseLifecycle } from '../../src/release/lifecycle';

const mockGit = {
  tags: jest.fn(),
  branchLocal: jest.fn(),
  checkoutBranch: jest.fn(),
  revparse: jest.fn(),
  addTag: jest.fn(),
  checkout: jest.fn(),
  merge: jest.fn(),
  fetch: jest.fn(),
  status: jest.fn(),
  add: jest.fn(),
  commit: jest.fn(),
};

beforeAll(() => {
  jest.mocked(simpleGit).mockReturnValue(mockGit as never);
});

describe('ReleaseLifecycle', () => {
  let release: ReleaseLifecycle;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(simpleGit).mockReturnValue(mockGit as never);
    release = new ReleaseLifecycle('/fake/repo');
  });

  describe('getLatestTag', () => {
    it('returns the latest semver tag', async () => {
      mockGit.tags.mockResolvedValue({ all: ['v1.2.3', 'v1.1.0', 'v1.0.0'] });
      expect(await release.getLatestTag()).toBe('v1.2.3');
    });

    it('returns null when no tags', async () => {
      mockGit.tags.mockResolvedValue({ all: [] });
      expect(await release.getLatestTag()).toBeNull();
    });

    it('filters out non-semver tags', async () => {
      mockGit.tags.mockResolvedValue({ all: ['latest', 'v1.0.0', 'stable'] });
      expect(await release.getLatestTag()).toBe('v1.0.0');
    });

    it('returns null on git error', async () => {
      mockGit.tags.mockRejectedValue(new Error('git error'));
      expect(await release.getLatestTag()).toBeNull();
    });
  });

  describe('autoNextRelease', () => {
    it('returns 1.0.0 when no tags exist', async () => {
      mockGit.tags.mockResolvedValue({ all: [] });
      expect(await release.autoNextRelease()).toBe('1.0.0');
    });

    it('bumps patch by default', async () => {
      mockGit.tags.mockResolvedValue({ all: ['v1.2.3'] });
      expect(await release.autoNextRelease()).toBe('1.2.4');
    });

    it('bumps minor when specified', async () => {
      mockGit.tags.mockResolvedValue({ all: ['v1.2.3'] });
      expect(await release.autoNextRelease('minor')).toBe('1.3.0');
    });

    it('bumps major when specified', async () => {
      mockGit.tags.mockResolvedValue({ all: ['v1.2.3'] });
      expect(await release.autoNextRelease('major')).toBe('2.0.0');
    });
  });

  describe('createReleaseBranch', () => {
    it('creates a release branch from main', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main', 'develop'] });
      mockGit.checkoutBranch.mockResolvedValue({});

      const branch = await release.createReleaseBranch('1.3.0');
      expect(branch).toBe('release/1.3.0');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith('release/1.3.0', 'main');
    });

    it('throws if the release branch already exists', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main', 'release/1.3.0'] });

      await expect(release.createReleaseBranch('1.3.0')).rejects.toThrow(
        'Release branch release/1.3.0 already exists',
      );
    });
  });

  describe('tagMain', () => {
    it('creates a tag on main', async () => {
      mockGit.tags.mockResolvedValue({ all: [] });
      mockGit.revparse.mockResolvedValue('main');
      mockGit.addTag.mockResolvedValue({});

      const tag = await release.tagMain('1.2.3');
      expect(tag).toBe('v1.2.3');
      expect(mockGit.addTag).toHaveBeenCalledWith('v1.2.3');
    });

    it('is idempotent when tag already exists', async () => {
      mockGit.tags.mockResolvedValue({ all: ['v1.2.3'] });

      const tag = await release.tagMain('1.2.3');
      expect(tag).toBe('v1.2.3');
      expect(mockGit.addTag).not.toHaveBeenCalled();
    });

    it('throws when not on main branch', async () => {
      mockGit.tags.mockResolvedValue({ all: [] });
      mockGit.revparse.mockResolvedValue('release/1.2.3');

      await expect(release.tagMain('1.2.3')).rejects.toThrow('Must be on main');
    });
  });

  describe('hotfixStart', () => {
    it('creates a hotfix branch from a tagged version', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });
      mockGit.checkoutBranch.mockResolvedValue({});

      const branch = await release.hotfixStart('1.2.3');
      expect(branch).toBe('hotfix/1.2.4');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith('hotfix/1.2.4', 'v1.2.3');
    });

    it('throws for an invalid base version', async () => {
      await expect(release.hotfixStart('not-valid')).rejects.toThrow('Invalid base version');
    });

    it('throws if hotfix branch already exists', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main', 'hotfix/1.2.4'] });

      await expect(release.hotfixStart('1.2.3')).rejects.toThrow(
        'Hotfix branch hotfix/1.2.4 already exists',
      );
    });
  });

  describe('hotfixFinish', () => {
    it('merges the hotfix branch into all targets', async () => {
      mockGit.revparse.mockResolvedValue('hotfix/1.2.4');
      mockGit.checkout.mockResolvedValue({});
      mockGit.merge.mockResolvedValue({});

      await release.hotfixFinish('hotfix/1.2.4', ['main', 'develop', 'release/1.2.0']);

      expect(mockGit.checkout).toHaveBeenCalledWith('main');
      expect(mockGit.checkout).toHaveBeenCalledWith('develop');
      expect(mockGit.checkout).toHaveBeenCalledWith('release/1.2.0');
      expect(mockGit.merge).toHaveBeenCalledTimes(3);
    });
  });

  describe('featureBranchName', () => {
    it('generates a conventional branch name', () => {
      expect(ReleaseLifecycle.featureBranchName('feat', 'LIN-123', 'Add user auth')).toBe(
        'feat/LIN-123-add-user-auth',
      );
    });

    it('slugifies special characters', () => {
      expect(
        ReleaseLifecycle.featureBranchName('fix', 'LIN-456', 'Fix OAuth2 / PKCE flow!'),
      ).toBe('fix/LIN-456-fix-oauth2-pkce-flow');
    });

    it('strips leading and trailing hyphens from slug', () => {
      expect(ReleaseLifecycle.featureBranchName('chore', 'LIN-789', '  Update deps  ')).toBe(
        'chore/LIN-789-update-deps',
      );
    });
  });
});
