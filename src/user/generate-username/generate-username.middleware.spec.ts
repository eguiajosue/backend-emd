import { GenerateUsernameMiddleware } from './generate-username.middleware';

describe('GenerateUsernameMiddleware', () => {
  it('should be defined', () => {
    expect(new GenerateUsernameMiddleware()).toBeDefined();
  });
});
