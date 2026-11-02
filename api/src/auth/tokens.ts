import jwt from 'jsonwebtoken';
import { config } from '../config.js';

type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  sub: string;
  type: TokenType;
}

export function signAccess(userId: string): string {
  return jwt.sign(
    { sub: userId, type: 'access' },
    config.jwtSecret,
    { expiresIn: config.accessTtl } as jwt.SignOptions
  );
}

export function signRefresh(userId: string): string {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    config.jwtSecret,
    { expiresIn: config.refreshTtl } as jwt.SignOptions
  );
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  return { sub: String(decoded.sub), type: decoded.type as TokenType };
}
