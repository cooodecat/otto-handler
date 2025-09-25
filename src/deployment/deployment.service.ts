import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Pipeline } from '../database/entities/pipeline.entity';
import { AwsEcsService } from '../aws/aws-ecs.service';
import { AwsAlbService } from '../aws/aws-alb.service';
import { AwsRoute53Service } from '../aws/aws-route53.service';
import { HealthCheckService } from './health-check.service';
import { ConfigService } from '@nestjs/config';
import {
  EC2Client,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from '@aws-sdk/client-ec2';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DescribeLogGroupsCommand,
  PutRetentionPolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs';

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);
  private readonly ec2Client: EC2Client;
  private readonly logsClient: CloudWatchLogsClient;

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    private readonly ecsService: AwsEcsService,
    private readonly albService: AwsAlbService,
    private readonly route53Service: AwsRoute53Service,
    private readonly healthCheckService: HealthCheckService,
    private configService: ConfigService,
  ) {
    this.ec2Client = new EC2Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-northeast-2'),
    });
    this.logsClient = new CloudWatchLogsClient({
      region: this.configService.get<string>('AWS_REGION', 'ap-northeast-2'),
    });
  }

  /**
   * 빌드 성공 후 배포 프로세스 실행
   * 1. deployUrl 생성 (없는 경우 - 10자리 해시.codecat-otto.shop 형식)
   * 2. code-cat ECS 클러스터에 서비스 생성/업데이트
   * 3. code-cat ALB 생성 또는 기존 ALB 사용 (공통 ALB 하나로 운영)
   * 4. ALB 타겟 그룹 설정 및 라우팅 규칙 추가
   * 5. Route53 DNS 레코드 생성 (서브도메인 -> ALB 연결)
   */
  async deployAfterBuild(
    pipelineId: string,
    userId: string,
  ): Promise<{
    deployUrl: string;
    ecsServiceArn: string;
    targetGroupArn: string;
    albDnsName: string;
  }> {
    this.logger.log(`🚀 배포 시작: pipelineId=${pipelineId}, userId=${userId}`);
    this.logger.log(`📋 [STEP 1/7] 파이프라인 정보 조회 중...`);

    // 1. 파이프라인 정보 조회 (ecrImageUri가 있어야 함 - 빌드 성공 조건)
    const pipeline = await this.pipelineRepository.findOne({
      where: { pipelineId },
      relations: ['project'],
    });

    if (!pipeline || !pipeline.ecrImageUri) {
      this.logger.error(
        `❌ [STEP 1/7] 실패: 파이프라인을 찾을 수 없거나 ECR 이미지가 없습니다`,
      );
      throw new Error(
        '파이프라인을 찾을 수 없거나 ECR 이미지가 없습니다 (빌드가 완료되지 않음)',
      );
    }

    this.logger.log(`✅ [STEP 1/7] 완료: 빌드된 ECR 이미지 발견`);
    this.logger.log(`   📦 이미지 URI: ${pipeline.ecrImageUri}`);
    this.logger.log(`   ⚙️  포트: ${pipeline.deployOption?.port || 3000}`);
    this.logger.log(
      `   🖥️  명령어: ${pipeline.deployOption?.command || 'npm start'}`,
    );
    this.logger.log(
      `   🌍 환경변수: ${pipeline.env ? Object.keys(pipeline.env).length + '개' : '없음'}`,
    );

    this.logger.log(`📋 [STEP 2/7] 배포 URL 생성/확인 중...`);

    // 2. deployUrl 생성 또는 기존 URL 사용
    // 형식: {10자리해시}.codecat-otto.shop (Date.now() + userId + pipelineId의 SHA256 해시)
    let deployUrl = pipeline.deployUrl;
    if (!deployUrl) {
      deployUrl = this.generateDeployUrl(userId, pipelineId);

      // DB에 deployUrl 저장
      await this.pipelineRepository.update(pipelineId, { deployUrl });
      this.logger.log(`✅ [STEP 2/7] 완료: 새 배포 URL 생성`);
      this.logger.log(`   🌐 URL: https://${deployUrl}`);
    } else {
      this.logger.log(`✅ [STEP 2/7] 완료: 기존 배포 URL 사용`);
      this.logger.log(`   🌐 URL: https://${deployUrl}`);
    }

    this.logger.log(`📋 [STEP 3/7] ALB 설정 중...`);

    // 3. code-cat ALB 설정 (없으면 생성) - ECS 서비스보다 먼저 생성
    const albResult = await this.setupApplicationLoadBalancer();

    this.logger.log(`📋 [STEP 4/7] 타겟 그룹 생성 중...`);

    // 4. ALB 타겟 그룹 생성 (동적 포트 사용)
    const targetGroupResult = await this.setupTargetGroup(
      pipelineId,
      albResult.vpcId,
      pipeline, // pipeline 객체 전달하여 포트 정보 접근
    );

    this.logger.log(`📋 [STEP 5/8] ECS 서비스 생성/업데이트 중...`);

    // 5-1. CloudWatch 로그 그룹 생성 (ECS 태스크용)
    await this.ensureLogGroupExists(pipelineId);

    // 5-2. code-cat 클러스터에 ECS 서비스 생성/업데이트 (타겟 그룹 연결 포함)
    const ecsServiceResult = await this.setupEcsService(
      pipeline,
      userId,
      deployUrl,
      targetGroupResult.targetGroupArn, // 타겟 그룹 ARN 전달
    );

    this.logger.log(`📋 [STEP 6/8] ALB 라우팅 규칙 추가 중...`);

    // 6. ALB 리스너에 라우팅 규칙 추가
    await this.setupAlbRouting(
      albResult.listenerArn,
      deployUrl,
      targetGroupResult.targetGroupArn,
    );

    this.logger.log(`📋 [STEP 7/8] Route53 DNS 설정 중...`);

    // 7. Route53 DNS 레코드 생성
    await this.setupRoute53Record(
      deployUrl,
      albResult.dnsName,
      albResult.canonicalHostedZoneId,
    );

    // 8. ECS 서비스 생성 시 로드밸런서를 연결했으므로 자동으로 타겟 등록됨
    this.logger.log(
      `📋 [STEP 8/8] ECS 서비스가 로드밸런서에 연결되어 자동으로 타겟 등록됩니다.`,
    );

    this.logger.log(`🎉 [완료] 배포 성공!`);
    this.logger.log(`   🌐 접속 URL: http://${deployUrl}`);
    this.logger.log(`   🔗 ALB DNS: ${albResult.dnsName}`);
    this.logger.log(`   📦 ECS 서비스: ${ecsServiceResult.serviceArn}`);

    return {
      deployUrl,
      ecsServiceArn: ecsServiceResult.serviceArn,
      targetGroupArn: targetGroupResult.targetGroupArn,
      albDnsName: albResult.dnsName,
    };
  }

  /**
   * 배포 URL 생성
   * 형식: {10자리해시}.codecat-otto.shop
   * 해시: SHA256(Date.now() + userId + pipelineId)의 앞 10자리
   */
  private generateDeployUrl(userId: string, pipelineId: string): string {
    const timestamp = Date.now().toString();
    const input = `${timestamp}${userId}${pipelineId}`;
    const hash = createHash('sha256').update(input).digest('hex');
    const shortHash = hash.substring(0, 10);

    return `${shortHash}.codecat-otto.shop`;
  }

  /**
   * code-cat 클러스터에 ECS 서비스 생성/업데이트
   * 각 파이프라인마다 별도의 ECS 서비스 생성
   */
  private async setupEcsService(
    pipeline: Pipeline,
    userId: string,
    deployUrl: string,
    targetGroupArn?: string, // 타겟 그룹 ARN 추가
  ): Promise<{ serviceArn: string }> {
    const clusterName = 'code-cat';
    const serviceName = `service-${pipeline.pipelineId}`;
    const taskFamily = `task-${pipeline.pipelineId}`;

    this.logger.log(
      `   🔧 ECS 서비스: ${serviceName} (클러스터: ${clusterName})`,
    );

    try {
      // deployOption에서 포트와 명령어 추출 (기본값: 포트 3000, 명령어 npm start)
      const containerPort = pipeline.deployOption?.port || 3000;
      const startCommand = pipeline.deployOption?.command || 'npm start';

      this.logger.log(`   📦 컨테이너 포트: ${containerPort}`);
      this.logger.log(`   🖥️  실행 명령어: ${startCommand}`);
      this.logger.log(`   🏷️  태스크 패밀리: ${taskFamily}`);

      // 1. 태스크 정의 등록 (pipeline.deployOption의 포트 및 명령어 반영)
      const taskDefinition = await this.ecsService.registerTaskDefinition({
        family: taskFamily,
        cpu: '256',
        memory: '512',
        networkMode: 'awsvpc',
        // Fargate + awslogs 사용을 위한 execution role 필요
        executionRoleArn: this.configService.get<string>(
          'CODEBUILD_SERVICE_ROLE_ARN',
        ),
        containerDefinitions: [
          {
            name: 'app',
            image: pipeline.ecrImageUri!,
            // pipeline.deployOption.port 사용 (기본값 3000)
            portMappings: [{ containerPort, protocol: 'tcp' }],
            // pipeline.deployOption.command 사용 (기본값 npm start)
            command: startCommand.split(' '), // "npm start" -> ["npm", "start"]
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': `/ecs/code-cat/${pipeline.pipelineId}`,
                'awslogs-region': process.env.AWS_REGION || 'ap-northeast-2',
                'awslogs-stream-prefix': 'ecs',
              },
            },
            environment: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'PORT', value: containerPort.toString() },
              { name: 'DEPLOY_URL', value: deployUrl },
              // pipeline.env가 있으면 추가 환경변수 설정
              ...(pipeline.env
                ? Object.entries(pipeline.env).map(([name, value]) => ({
                    name,
                    value,
                  }))
                : []),
            ],
          },
        ],
      });

      this.logger.log(
        `   ✅ 태스크 정의 등록 완료: ${taskDefinition.taskDefinition?.taskDefinitionArn}`,
      );

      // 2. 기존 서비스 확인
      let serviceExists = false;
      try {
        const describeResult = await this.ecsService.describeServices(
          clusterName,
          [serviceName],
        );

        // 서비스가 존재하고 ACTIVE 상태인지 확인
        const service = describeResult.services?.find(
          (s) => s.serviceName === serviceName,
        );
        if (service && service.status === 'ACTIVE') {
          serviceExists = true;
          this.logger.log(
            `   🔍 기존 ECS 서비스 발견: ${serviceName} (업데이트 모드)`,
          );
        } else {
          this.logger.log(`   🆕 새 ECS 서비스 생성 필요: ${serviceName}`);
        }
      } catch (error) {
        this.logger.log(
          `   🆕 새 ECS 서비스 생성 필요: ${serviceName} (오류: ${error instanceof Error ? error.message : String(error)})`,
        );
      }

      let serviceArn: string;

      if (serviceExists) {
        // 3-1. 기존 서비스 업데이트 (롤링 배포)
        this.logger.log(`   🔄 롤링 배포 시작...`);
        const updateResult = await this.ecsService.updateService(
          clusterName,
          serviceName,
          1, // desiredCount
          taskDefinition.taskDefinition?.taskDefinitionArn,
        );
        serviceArn = updateResult.service?.serviceArn || '';
        this.logger.log(`✅ [STEP 5/7] 완료: ECS 서비스 업데이트`);
        this.logger.log(`   🔗 서비스 ARN: ${serviceArn}`);
      } else {
        // 3-2. 새 서비스 생성
        this.logger.log(`   🏗️  새 서비스 생성 중...`);
        // AWS 네트워크 리소스 조회
        const { subnetIds, vpcId } = await this.getAvailableSubnets();
        const securityGroups = await this.getDefaultSecurityGroups(vpcId);

        const createResult = await this.ecsService.createService({
          serviceName,
          cluster: clusterName,
          taskDefinition:
            taskDefinition.taskDefinition?.taskDefinitionArn || '',
          desiredCount: 1,
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: subnetIds,
              securityGroups: securityGroups,
              assignPublicIp: 'ENABLED',
            },
          },
          // ALB 연결 설정 추가
          ...(targetGroupArn && {
            loadBalancers: [
              {
                targetGroupArn,
                containerName: 'app',
                containerPort: containerPort,
              },
            ],
          }),
        });
        serviceArn = createResult.service?.serviceArn || '';
        this.logger.log(`✅ [STEP 5/7] 완료: 새 ECS 서비스 생성`);
        this.logger.log(`   🔗 서비스 ARN: ${serviceArn}`);
      }

      return { serviceArn };
    } catch (error) {
      this.logger.error(`ECS 서비스 설정 실패: ${error}`);
      throw new Error(`ECS 서비스 설정 실패: ${error}`);
    }
  }

  /**
   * code-cat ALB 생성 또는 기존 ALB 정보 반환
   * ALB는 하나만 사용하고 여러 서비스가 공유
   */
  private async setupApplicationLoadBalancer(): Promise<{
    albArn: string;
    dnsName: string;
    listenerArn: string;
    vpcId: string;
    canonicalHostedZoneId: string;
  }> {
    const albName = 'code-cat-balancer';

    this.logger.log(`   🔍 ALB 확인: ${albName}`);

    try {
      // 1. 기존 ALB 확인 (이름으로 검색)
      const existingAlb = await this.albService.findLoadBalancerByName(albName);

      if (existingAlb) {
        this.logger.log(`   ✅ 기존 ALB 발견: ${albName}`);

        // 기존 ALB의 리스너 조회
        const listeners = await this.albService.describeListeners(
          existingAlb.arn,
        );
        const httpListener = listeners.find(
          (l) => l.protocol === 'HTTP' && l.port === 80,
        );

        if (!httpListener) {
          throw new Error('ALB HTTP 리스너를 찾을 수 없습니다');
        }

        this.logger.log(`✅ [STEP 3/7] 완료: 기존 ALB 사용`);
        this.logger.log(`   🔗 ALB DNS: ${existingAlb.dnsName}`);
        this.logger.log(`   🎯 리스너 ARN: ${httpListener.arn}`);

        return {
          albArn: existingAlb.arn,
          dnsName: existingAlb.dnsName,
          listenerArn: httpListener.arn,
          vpcId: existingAlb.vpcId || '',
          canonicalHostedZoneId: existingAlb.canonicalHostedZoneId,
        };
      }

      // 2. 새 ALB 생성
      this.logger.log(`   🏗️  새 ALB 생성: ${albName}`);

      // AWS 네트워크 리소스 조회
      const { subnetIds, vpcId } = await this.getAvailableSubnets();
      const securityGroups = await this.getDefaultSecurityGroups(vpcId);

      const newAlb = await this.albService.createLoadBalancer({
        name: albName,
        subnets: subnetIds,
        securityGroups: securityGroups,
        scheme: 'internet-facing',
        type: 'application',
      });

      // 3. HTTP 리스너 생성 (기본 404 응답)
      const listener = await this.albService.createListener({
        loadBalancerArn: newAlb.arn,
        protocol: 'HTTP',
        port: 80,
        defaultActions: [
          {
            type: 'fixed-response',
            fixedResponseConfig: {
              statusCode: '404',
              contentType: 'text/plain',
              messageBody: 'Not Found',
            },
          },
        ],
      });

      this.logger.log(`✅ [STEP 3/7] 완료: 새 ALB 생성`);
      this.logger.log(`   🔗 ALB DNS: ${newAlb.dnsName}`);
      this.logger.log(`   🎯 리스너 ARN: ${listener.arn}`);

      return {
        albArn: newAlb.arn,
        dnsName: newAlb.dnsName,
        listenerArn: listener.arn,
        vpcId: newAlb.vpcId || '',
        canonicalHostedZoneId: newAlb.canonicalHostedZoneId,
      };
    } catch (error) {
      this.logger.error(`ALB 설정 실패: ${error}`);
      throw new Error(`ALB 설정 실패: ${error}`);
    }
  }

  /**
   * 타겟 그룹 생성 (동적 포트 지원)
   * 각 ECS 서비스마다 별도의 타겟 그룹 생성, pipeline.deployOption.port 사용
   */
  private async setupTargetGroup(
    pipelineId: string,
    vpcId: string,
    pipeline: Pipeline, // pipeline 객체 추가하여 포트 정보 접근
  ): Promise<{ targetGroupArn: string }> {
    const targetGroupName = `tg-${pipelineId.substring(0, 20)}`;

    // pipeline.deployOption.port 사용 (기본값 3000)
    const containerPort = pipeline.deployOption?.port || 3000;

    this.logger.log(
      `   🎯 타겟 그룹: ${targetGroupName} (포트: ${containerPort})`,
    );
    this.logger.log(
      `   📊 Pipeline deployOption: ${JSON.stringify(pipeline.deployOption)}`,
    );

    try {
      // 1. 기존 타겟 그룹 확인
      let targetGroupArn: string;

      try {
        const existingTargetGroups = await this.albService.listTargetGroups();
        const existingTargetGroup = existingTargetGroups.find(
          (tg) => tg.name === targetGroupName,
        );

        if (existingTargetGroup) {
          this.logger.log(`   ✅ 기존 타겟 그룹 재사용: ${targetGroupName}`);
          targetGroupArn = existingTargetGroup.arn;
        } else {
          // 2. 새 타겟 그룹 생성
          const targetGroup = await this.albService.createTargetGroup({
            name: targetGroupName,
            protocol: 'HTTP',
            port: containerPort, // 동적 포트 사용
            vpcId,
            targetType: 'ip', // Fargate는 IP 타겟 타입 사용
            healthCheck: {
              path: '/', // 루트 경로로 헬스체크 (기본적으로 응답하는 경로)
              protocol: 'HTTP',
              port: containerPort.toString(), // 헬스체크도 동적 포트 사용
              intervalSeconds: 30,
              timeoutSeconds: 5,
              healthyThresholdCount: 2,
              unhealthyThresholdCount: 5, // 더 관대하게 설정
              matcher: '200,404', // 404도 healthy로 간주 (페이지가 없어도 서버는 응답중)
            },
          });
          targetGroupArn = targetGroup.arn;
        }
      } catch (error) {
        throw new Error(`타겟 그룹 설정 실패: ${error}`);
      }

      this.logger.log(`✅ [STEP 4/7] 완료: 타겟 그룹 설정`);
      this.logger.log(`   🎯 타겟 그룹 ARN: ${targetGroupArn}`);
      this.logger.log(`   🔍 헬스체크: / (포트: ${containerPort})`);

      return { targetGroupArn };
    } catch (error) {
      this.logger.error(`❌ [STEP 4/7] 실패: 타겟 그룹 생성 - ${error}`);
      throw new Error(`타겟 그룹 생성 실패: ${error}`);
    }
  }

  /**
   * ALB 리스너에 라우팅 규칙 추가
   * 호스트 헤더 기반으로 각 서비스로 라우팅
   */
  private async setupAlbRouting(
    listenerArn: string,
    deployUrl: string,
    targetGroupArn: string,
  ): Promise<void> {
    this.logger.log(`   🌐 라우팅 규칙: ${deployUrl} → 타겟 그룹`);

    try {
      // 1. 기존 규칙 확인 및 삭제
      const existingRules = await this.albService.findRulesByHostHeader(
        listenerArn,
        deployUrl,
      );

      if (existingRules.length > 0) {
        this.logger.log(
          `   🗑️  기존 규칙 ${existingRules.length}개 삭제 중...`,
        );

        for (const rule of existingRules) {
          await this.albService.deleteRule(rule.ruleArn);
          this.logger.log(`   ✅ 규칙 삭제: Priority ${rule.priority}`);
        }
      }

      // 2. 새 규칙 추가
      await this.albService.createListenerRule({
        listenerArn,
        conditions: [
          {
            field: 'host-header',
            values: [deployUrl],
          },
        ],
        actions: [
          {
            type: 'forward',
            targetGroupArn,
          },
        ],
        priority: Math.floor(Math.random() * 50000) + 1, // 랜덤 우선순위
      });

      this.logger.log(`✅ [STEP 6/8] 완료: ALB 라우팅 규칙 설정`);
      this.logger.log(`   🌐 호스트 헤더: ${deployUrl}`);
      this.logger.log(`   🎯 타겟 그룹: ${targetGroupArn}`);
    } catch (error) {
      this.logger.error(`❌ [STEP 6/8] 실패: ALB 라우팅 설정 - ${error}`);
      throw new Error(`ALB 라우팅 설정 실패: ${error}`);
    }
  }

  /**
   * Route53 DNS 레코드 생성
   * 서브도메인을 ALB로 연결
   */
  private async setupRoute53Record(
    deployUrl: string,
    albDnsName: string,
    albCanonicalHostedZoneId: string,
  ): Promise<void> {
    this.logger.log(`   🌍 DNS 레코드: ${deployUrl} → ${albDnsName}`);

    try {
      // 1. deployUrl에서 기본 도메인 추출 (예: "codecat-otto.shop")
      const baseDomain = this.extractBaseDomain(deployUrl);
      this.logger.log(`   🔍 기본 도메인: ${baseDomain}`);

      // 2. 기존 호스트존 검색
      let hostedZoneId: string;
      const existingZone =
        await this.route53Service.findHostedZoneByDomain(baseDomain);

      if (existingZone) {
        // 기존 호스트존 사용
        hostedZoneId = existingZone.hostedZoneId;
        this.logger.log(`   ✅ 기존 호스트존 발견: ${hostedZoneId}`);
      } else {
        // 새 호스트존 생성
        this.logger.log(`   🏗️  새 호스트존 생성: ${baseDomain}`);
        const newZone = await this.route53Service.createHostedZone({
          name: baseDomain,
          comment: `Otto 자동 생성 - ${baseDomain}`,
          privateZone: false,
        });
        hostedZoneId = newZone.hostedZoneId;
        this.logger.log(`   ✅ 새 호스트존 생성 완료: ${hostedZoneId}`);
        this.logger.log(`   📝 네임서버: ${newZone.nameServers.join(', ')}`);
      }

      // 3. DNS 레코드 생성
      await this.route53Service.createRecord({
        hostedZoneId,
        name: deployUrl,
        type: 'A',
        aliasTarget: {
          dnsName: albDnsName,
          hostedZoneId: albCanonicalHostedZoneId, // ALB의 실제 canonical hosted zone ID
          evaluateTargetHealth: true,
        },
      });

      this.logger.log(`✅ [STEP 7/8] 완료: Route53 DNS 레코드 생성`);
      this.logger.log(`   🌍 도메인: ${deployUrl}`);
      this.logger.log(`   🎯 ALB 대상: ${albDnsName}`);
    } catch (error) {
      // DNS 레코드가 이미 존재하는 경우는 경고만 표시하고 계속 진행
      if (
        (error instanceof Error && error.message.includes('already exists')) ||
        (error instanceof Error &&
          error.message.includes('but it already exists'))
      ) {
        this.logger.warn(`⚠️  [STEP 7/8] DNS 레코드가 이미 존재: ${deployUrl}`);
        this.logger.log(`✅ [STEP 7/8] 완료: 기존 DNS 레코드 사용`);
        this.logger.log(`   🌍 도메인: ${deployUrl}`);
        this.logger.log(`   🎯 ALB 대상: ${albDnsName}`);
      } else {
        this.logger.error(`❌ [STEP 7/8] 실패: Route53 설정 - ${error}`);
        throw new Error(`Route53 설정 실패: ${error}`);
      }
    }
  }

  /**
   * URL에서 기본 도메인 추출
   * 예: "abc123.codecat-otto.shop" → "codecat-otto.shop"
   */
  private extractBaseDomain(url: string): string {
    const parts = url.split('.');
    if (parts.length >= 2) {
      // 마지막 두 부분을 기본 도메인으로 사용 (예: codecat-otto.shop)
      return parts.slice(-2).join('.');
    }
    return url;
  }

  /**
   * 사용 가능한 서브넷 ID 목록 조회
   * 기본 VPC의 퍼블릭 서브넷들을 반환
   */
  private async getAvailableSubnets(): Promise<{
    subnetIds: string[];
    vpcId: string;
  }> {
    try {
      const command = new DescribeSubnetsCommand({
        Filters: [
          {
            Name: 'default-for-az',
            Values: ['true'],
          },
          {
            Name: 'state',
            Values: ['available'],
          },
        ],
      });

      const result = await this.ec2Client.send(command);
      const subnets = result.Subnets || [];

      if (subnets.length === 0) {
        throw new Error('사용 가능한 서브넷을 찾을 수 없습니다');
      }

      const subnetIds = subnets
        .map((subnet) => subnet.SubnetId)
        .filter(Boolean) as string[];
      const vpcId = subnets[0].VpcId; // 모든 서브넷은 같은 VPC에 있어야 함

      this.logger.log(
        `   🌐 발견된 서브넷: ${subnetIds.join(', ')} (VPC: ${vpcId})`,
      );

      return { subnetIds, vpcId: vpcId! };
    } catch (error) {
      this.logger.error(`서브넷 조회 실패: ${error}`);
      // 폴백: 환경변수에서 가져오기
      const fallbackSubnets = this.configService.get<string>(
        'AWS_ECS_SUBNETS',
        '',
      );
      const fallbackVpc = this.configService.get<string>('AWS_VPC_ID', '');
      if (fallbackSubnets && fallbackVpc) {
        return { subnetIds: fallbackSubnets.split(','), vpcId: fallbackVpc };
      }
      throw new Error(`서브넷 조회 실패: ${error}`);
    }
  }

  /**
   * CloudWatch 로그 그룹 존재 확인 및 생성
   * ECS 태스크가 로그를 기록할 수 있도록 로그 그룹을 미리 생성
   */
  private async ensureLogGroupExists(pipelineId: string): Promise<void> {
    const logGroupName = `/ecs/code-cat/${pipelineId}`;

    try {
      this.logger.log(`   📝 CloudWatch 로그 그룹 확인: ${logGroupName}`);

      // 1. 기존 로그 그룹 확인
      const describeCommand = new DescribeLogGroupsCommand({
        logGroupNamePrefix: logGroupName,
      });

      const result = await this.logsClient.send(describeCommand);
      const existingGroup = result.logGroups?.find(
        (group) => group.logGroupName === logGroupName,
      );

      if (existingGroup) {
        this.logger.log(`   ✅ 기존 로그 그룹 발견: ${logGroupName}`);
        return;
      }

      // 2. 새 로그 그룹 생성
      this.logger.log(`   🏗️  새 로그 그룹 생성: ${logGroupName}`);
      const createCommand = new CreateLogGroupCommand({
        logGroupName,
      });

      await this.logsClient.send(createCommand);
      this.logger.log(`   ✅ 로그 그룹 생성 완료: ${logGroupName}`);

      // 3. 30일 후 자동 삭제 설정
      const retentionCommand = new PutRetentionPolicyCommand({
        logGroupName,
        retentionInDays: 30,
      });

      await this.logsClient.send(retentionCommand);
      this.logger.log(`   ⏰ 로그 보존 정책 설정: 30일`);
    } catch (error) {
      // 로그 그룹이 이미 존재하는 경우는 무시
      if (
        error instanceof Error &&
        error.name === 'ResourceAlreadyExistsException'
      ) {
        this.logger.log(`   ✅ 로그 그룹이 이미 존재: ${logGroupName}`);
        return;
      }

      this.logger.error(`❌ 로그 그룹 생성 실패: ${error}`);
      throw new Error(`로그 그룹 생성 실패: ${error}`);
    }
  }

  /**
   * ECS 서비스의 타겟을 타겟 그룹에 자동 등록/업데이트
   * 기존 타겟은 제거하고 새로운 태스크의 IP를 등록
   */
  private async updateTargetGroupTargets(
    serviceArn: string,
    targetGroupArn: string,
    containerPort: number,
  ): Promise<void> {
    try {
      const arnParts = serviceArn.split('/');
      const clusterName = arnParts[1];
      const serviceName = arnParts[2];

      this.logger.log(`   🔗 ECS 서비스: ${serviceName}`);
      this.logger.log(`   🎯 타겟 그룹: ${targetGroupArn}`);
      this.logger.log(`   🔌 컨테이너 포트: ${containerPort}`);

      // 1. 기존 타겟들 조회 및 제거
      const existingTargets =
        await this.albService.getTargetHealth(targetGroupArn);
      if (existingTargets.length > 0) {
        this.logger.log(
          `   🗑️  기존 타겟 ${existingTargets.length}개 제거 중...`,
        );

        for (const target of existingTargets) {
          await this.albService.deregisterTarget(targetGroupArn, {
            id: target.target.id,
            port: target.target.port || containerPort,
          });
          this.logger.log(
            `   ✅ 타겟 제거: ${target.target.id}:${target.target.port}`,
          );
        }
      }

      // 2. 현재 실행 중인 태스크들의 IP 조회
      let retryCount = 0;
      const maxRetries = 10;
      let taskIps: string[] = [];

      while (retryCount < maxRetries) {
        // 서비스의 태스크 목록 조회
        const tasks = await this.ecsService.listTasks(clusterName, serviceName);

        if (tasks.taskArns && tasks.taskArns.length > 0) {
          // 태스크 상세 정보 조회
          const taskDetails = await this.ecsService.describeTasks(
            clusterName,
            tasks.taskArns,
          );

          taskIps =
            taskDetails.tasks
              ?.filter((task) => task.lastStatus === 'RUNNING')
              .map((task) => {
                const eni = task.attachments?.[0]?.details?.find(
                  (detail) => detail.name === 'privateIPv4Address',
                );
                return eni?.value;
              })
              .filter((ip): ip is string => Boolean(ip)) || [];

          if (taskIps.length > 0) {
            break;
          }
        }

        this.logger.log(
          `   ⏳ 실행 중인 태스크 대기 중... (${retryCount + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000)); // 3초 대기
        retryCount++;
      }

      if (taskIps.length === 0) {
        throw new Error('실행 중인 태스크를 찾을 수 없습니다');
      }

      // 3. 새로운 타겟들 등록
      this.logger.log(`   ➕ 새로운 타겟 ${taskIps.length}개 등록 중...`);

      for (const ip of taskIps) {
        await this.albService.registerTarget(targetGroupArn, {
          id: ip,
          port: containerPort,
        });
        this.logger.log(`   ✅ 타겟 등록: ${ip}:${containerPort}`);
      }

      this.logger.log(`✅ [STEP 8/8] 완료: 타겟 그룹 업데이트`);
      this.logger.log(`   🎯 등록된 타겟: ${taskIps.join(', ')}`);
    } catch (error) {
      this.logger.error(`❌ [STEP 8/8] 실패: 타겟 그룹 업데이트 - ${error}`);
      throw new Error(`타겟 그룹 업데이트 실패: ${error}`);
    }
  }

  /**
   * 특정 VPC의 기본 보안 그룹 ID 목록 조회
   * 지정된 VPC의 default 보안 그룹을 반환
   */
  private async getDefaultSecurityGroups(vpcId: string): Promise<string[]> {
    try {
      const command = new DescribeSecurityGroupsCommand({
        Filters: [
          {
            Name: 'group-name',
            Values: ['default'],
          },
          {
            Name: 'vpc-id',
            Values: [vpcId],
          },
        ],
      });

      const result = await this.ec2Client.send(command);
      const sgIds =
        result.SecurityGroups?.map((sg) => sg.GroupId).filter(Boolean) || [];

      this.logger.log(`   🔒 VPC ${vpcId}의 보안 그룹: ${sgIds.join(', ')}`);

      if (sgIds.length === 0) {
        throw new Error(`VPC ${vpcId}에서 기본 보안 그룹을 찾을 수 없습니다`);
      }

      return sgIds as string[];
    } catch (error) {
      this.logger.error(`보안 그룹 조회 실패: ${error}`);
      // 폴백: 환경변수에서 가져오기
      const fallbackSgs = this.configService.get<string>(
        'AWS_ECS_SECURITY_GROUPS',
        '',
      );
      if (fallbackSgs) {
        return fallbackSgs.split(',');
      }
      throw new Error(`보안 그룹 조회 실패: ${error}`);
    }
  }
}
