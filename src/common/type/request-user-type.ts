import { FastifyRequest } from 'fastify';

export interface IRequestType extends FastifyRequest {
  user: {
    user_id: string;
    nickname: string;
    email: string;
  };
}
