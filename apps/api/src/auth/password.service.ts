import { argon2id, hash, verify } from 'argon2';

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

export class PasswordService {
  assertValid(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`Password must contain at most ${MAX_PASSWORD_LENGTH} characters.`);
    }
  }

  async hash(password: string): Promise<string> {
    this.assertValid(password);
    return hash(password, { type: argon2id, timeCost: 3, memoryCost: 65_536, parallelism: 1 });
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }
}
