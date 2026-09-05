import { GenerateUsernameMiddleware } from './generate-username.middleware';
import { UserService } from '../user.service';

describe('GenerateUsernameMiddleware', () => {
  it('should be defined', () => {
    const userServiceMock = {
      usernameExists: jest.fn().mockResolvedValue(false),
    } as unknown as UserService;

    expect(new GenerateUsernameMiddleware(userServiceMock)).toBeDefined();
  });
});
