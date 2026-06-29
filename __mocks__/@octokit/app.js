'use strict';
class App {
  constructor() {
    this.webhooks = {
      on: jest.fn(),
      receive: jest.fn(),
    };
  }
  getInstallationOctokit() {
    return Promise.resolve({});
  }
}
module.exports = { App };
