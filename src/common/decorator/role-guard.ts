// roles.decorator.ts
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuardRole } from '../guard';

// Role type definition (since MemberRole doesn't exist in schema)
export type UserRole = 'ADMIN' | 'USER';

export const ROLES_KEY = Symbol('roles');
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const AuthGuard = (roles?: UserRole | UserRole[]) => {
  const decorators = [UseGuards(AuthGuardRole)];

  if (roles) {
    const roleArray = Array.isArray(roles) ? roles : [roles];
    decorators.push(Roles(...roleArray));
  }

  return applyDecorators(...decorators);
};
