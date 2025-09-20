import { Controller, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { TypedRoute } from '@nestia/core';
import { AuthGuard } from '../common/decorator';
import type { IRequestType } from '../common/type';
import type { UserResponse } from './dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @TypedRoute.Get()
  @AuthGuard()
  userGetMyInfo(@Req() request: IRequestType): UserResponse {
    return request.user;
  }
}
