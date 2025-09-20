import { FastifyRequest } from 'fastify';

export interface IRequestType extends FastifyRequest {
  user: {
    userId: string;
    nickname: string;
    email: string;
  };
}
