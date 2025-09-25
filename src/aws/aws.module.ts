import { Module } from '@nestjs/common';
import { AwsEcsService } from './aws-ecs.service';
import { AwsEcrService } from './aws-ecr.service';
import { AwsRoute53Service } from './aws-route53.service';
import { AwsAlbService } from './aws-alb.service';
import { AwsInfrastructureService } from './aws-infrastructure.service';

/**
 * AWS 관련 서비스들을 관리하는 모듈
 */
@Module({
  providers: [
    AwsEcsService,
    AwsEcrService,
    AwsRoute53Service,
    AwsAlbService,
    AwsInfrastructureService,
  ],
  exports: [
    AwsEcsService,
    AwsEcrService,
    AwsRoute53Service,
    AwsAlbService,
    AwsInfrastructureService,
  ],
})
export class AwsModule {}
