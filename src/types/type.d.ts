import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    cookies: Record<string, string>;
  }

  interface FastifyReply {
    setCookie(name: string, value: string, options?: any): FastifyReply;
    clearCookie(name: string, options?: any): FastifyReply;
    unsignCookie(value: string): {
      valid: boolean;
      renew: boolean;
      value: string | null;
    };
  }
}
