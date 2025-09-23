import { Controller, Get, Param } from '@nestjs/common';
import { AwsEcsService } from '../aws/aws-ecs.service';
import { AwsAlbService } from '../aws/aws-alb.service';
import { PipelineService } from '../pipeline/pipeline.service';

@Controller('debug')
export class DebugController {
  constructor(
    private readonly ecsService: AwsEcsService,
    private readonly albService: AwsAlbService,
    private readonly pipelineService: PipelineService,
  ) {}

  @Get('pipeline/:pipelineId')
  async checkPipelineStatus(@Param('pipelineId') pipelineId: string) {
    try {
      // 1. 파이프라인 정보 조회
      const pipeline = await this.pipelineService.getPipelineById(pipelineId, 'system');
      
      const serviceName = `service-${pipelineId.substring(0, 20)}`;
      const clusterName = 'code-cat-cluster';
      const targetGroupName = `tg-${pipelineId.substring(0, 20)}`;

      // 2. ECS 서비스 상태 확인
      let ecsStatus;
      try {
        const services = await this.ecsService.describeServices(clusterName, [serviceName]);
        ecsStatus = {
          found: services.services && services.services.length > 0,
          service: services.services?.[0] ? {
            serviceName: services.services[0].serviceName,
            status: services.services[0].status,
            runningCount: services.services[0].runningCount,
            pendingCount: services.services[0].pendingCount,
            desiredCount: services.services[0].desiredCount,
            taskDefinition: services.services[0].taskDefinition,
          } : null,
        };
      } catch (error) {
        ecsStatus = { error: error.message };
      }

      // 3. ALB 타겟 그룹 상태 확인
      let targetGroupStatus;
      try {
        const targetGroups = await this.albService.listTargetGroups();
        const targetGroup = targetGroups.find(tg => tg.name.includes(targetGroupName.substring(0, 15)));
        
        if (targetGroup) {
          const health = await this.albService.getTargetHealth(targetGroup.arn);
          targetGroupStatus = {
            found: true,
            targetGroup: {
              name: targetGroup.name,
              protocol: targetGroup.protocol,
              port: targetGroup.port,
              healthCheck: targetGroup.healthCheck,
            },
            targets: health,
          };
        } else {
          targetGroupStatus = { found: false };
        }
      } catch (error) {
        targetGroupStatus = { error: error.message };
      }

      return {
        pipeline: {
          id: pipeline.pipelineId,
          name: pipeline.pipelineName,
          ecrImageUri: pipeline.ecrImageUri,
          deployOption: (pipeline as any).deployOption,
        },
        ecs: ecsStatus,
        targetGroup: targetGroupStatus,
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  @Get('pipelines')
  async getAllPipelines() {
    try {
      // 시스템 계정으로 모든 파이프라인 조회 (실제로는 권한 확인 필요)
      const pipelines = await this.pipelineService.getPipelines({}, 'system');
      return pipelines.map(p => ({
        id: p.pipelineId,
        name: p.pipelineName,
        projectId: p.projectId,
        ecrImageUri: p.ecrImageUri,
        hasImage: !!p.ecrImageUri,
      }));
    } catch (error) {
      return { error: error.message };
    }
  }

  @Get('health')
  getHealth() {
    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      message: 'Debug health check endpoint',
    };
  }
}