import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign, type SignOptions, verify } from 'jsonwebtoken';

@Injectable()
export class JwtService {
  constructor(private configService: ConfigService) {}

  encode<T extends object>(payload: T, options?: SignOptions): string {
    return sign(
      payload,
      this.configService.get<string>('JWT_SECRET') ?? '441512121212154874848',
      options,
    );
  }

  decode<T>(token: string): T | null {
    try {
      return verify(
        token,
        this.configService.get<string>('JWT_SECRET') ?? '441512121212154874848',
      ) as T;
    } catch {
      return null;
    }
  }
}
