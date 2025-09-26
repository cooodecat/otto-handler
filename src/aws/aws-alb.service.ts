import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EC2Client, DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import {
  ActionTypeEnum,
  CreateListenerCommand,
  CreateLoadBalancerCommand,
  CreateRuleCommand,
  CreateTargetGroupCommand,
  DeleteListenerCommand,
  DeleteLoadBalancerCommand,
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
  DeregisterTargetsCommand,
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeRulesCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  ModifyLoadBalancerAttributesCommand,
  ModifyRuleCommand,
  ModifyTargetGroupAttributesCommand,
  RedirectActionStatusCodeEnum,
  RegisterTargetsCommand,
  TargetHealthStateEnum,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  CreateListenerInput,
  CreateListenerRuleInput,
  CreateLoadBalancerInput,
  CreateTargetGroupInput,
  ListenerInfo,
  LoadBalancerInfo,
  RegisterTargetsInput,
  TargetGroupInfo,
  TargetHealth,
} from './types/alb.types';

@Injectable()
export class AwsAlbService {
  private readonly logger = new Logger(AwsAlbService.name);
  private readonly elbv2Client: ElasticLoadBalancingV2Client;
  private readonly ec2Client: EC2Client;

  constructor(private configService: ConfigService) {
    // 리전을 ap-northeast-2로 하드코딩
    const region = 'ap-northeast-2';
    this.logger.log(`ALB Service 초기화 - 리전: ${region}`);

    const credentials = {
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
    };

    this.elbv2Client = new ElasticLoadBalancingV2Client({
      region,
      credentials,
    });

    this.ec2Client = new EC2Client({
      region,
      credentials,
    });
  }

  /**
   * Application Load Balancer 생성
   * 새로운 ALB를 생성하고 설정합니다
   */
  async createLoadBalancer(
    input: CreateLoadBalancerInput,
  ): Promise<LoadBalancerInfo> {
    try {
      // 디버깅: 입력된 서브넷 확인
      this.logger.log(`ALB 생성 시도 - 이름: ${input.name}`);
      this.logger.log(
        `ALB 생성 시도 - 서브넷: ${JSON.stringify(input.subnets)}`,
      );
      this.logger.log(
        `ALB 생성 시도 - 보안그룹: ${JSON.stringify(input.securityGroups)}`,
      );

      // 서브넷 존재 여부 직접 확인
      await this.verifySubnetsExist(input.subnets);

      const command = new CreateLoadBalancerCommand({
        Name: input.name,
        Subnets: input.subnets,
        SecurityGroups: input.securityGroups,
        Scheme: input.scheme || 'internet-facing',
        Type: input.type || 'application',
        IpAddressType: input.ipAddressType || 'ipv4',
        Tags: input.tags?.map((tag) => ({
          Key: tag.key,
          Value: tag.value,
        })),
      });

      const result = await this.elbv2Client.send(command);
      const loadBalancer = result.LoadBalancers?.[0];

      if (!loadBalancer) {
        throw new Error('로드밸런서 생성 응답이 비어있습니다');
      }

      this.logger.log(`ALB 생성 완료: ${input.name}`);

      return {
        arn: loadBalancer.LoadBalancerArn || '',
        name: loadBalancer.LoadBalancerName || '',
        dnsName: loadBalancer.DNSName || '',
        canonicalHostedZoneId: loadBalancer.CanonicalHostedZoneId || '',
        state: loadBalancer.State?.Code || '',
        scheme: loadBalancer.Scheme || '',
        type: loadBalancer.Type || '',
        vpcId: loadBalancer.VpcId,
        availabilityZones:
          loadBalancer.AvailabilityZones?.map((az) => ({
            zoneName: az.ZoneName || '',
            subnetId: az.SubnetId || '',
          })) || [],
        securityGroups: loadBalancer.SecurityGroups || [],
        ipAddressType: loadBalancer.IpAddressType || '',
        createdTime: loadBalancer.CreatedTime,
      };
    } catch (error) {
      this.logger.error(`ALB 생성 실패: ${error}`);
      throw new Error(`ALB 생성 실패: ${error}`);
    }
  }

  /**
   * Load Balancer 삭제
   * 지정된 로드밸런서를 삭제합니다
   */
  async deleteLoadBalancer(loadBalancerArn: string): Promise<void> {
    try {
      const command = new DeleteLoadBalancerCommand({
        LoadBalancerArn: loadBalancerArn,
      });

      await this.elbv2Client.send(command);
      this.logger.log(`ALB 삭제 완료: ${loadBalancerArn}`);
    } catch (error) {
      this.logger.error(`ALB 삭제 실패: ${error}`);
      throw new Error(`ALB 삭제 실패: ${error}`);
    }
  }

  /**
   * 타겟 그룹 생성
   * 로드밸런서의 타겟을 관리할 타겟 그룹을 생성합니다
   */
  async createTargetGroup(
    input: CreateTargetGroupInput,
  ): Promise<TargetGroupInfo> {
    try {
      const command = new CreateTargetGroupCommand({
        Name: input.name,
        Protocol: input.protocol,
        Port: input.port,
        VpcId: input.vpcId,
        TargetType: input.targetType || 'instance',
        HealthCheckPath: input.healthCheck?.path,
        HealthCheckProtocol: input.healthCheck?.protocol,
        HealthCheckPort: input.healthCheck?.port,
        HealthCheckIntervalSeconds: input.healthCheck?.intervalSeconds,
        HealthCheckTimeoutSeconds: input.healthCheck?.timeoutSeconds,
        HealthyThresholdCount: input.healthCheck?.healthyThresholdCount,
        UnhealthyThresholdCount: input.healthCheck?.unhealthyThresholdCount,
        Matcher: input.healthCheck?.matcher
          ? { HttpCode: input.healthCheck.matcher }
          : undefined,
        Tags: input.tags?.map((tag) => ({
          Key: tag.key,
          Value: tag.value,
        })),
      });

      const result = await this.elbv2Client.send(command);
      const targetGroup = result.TargetGroups?.[0];

      if (!targetGroup) {
        throw new Error('타겟 그룹 생성 응답이 비어있습니다');
      }

      this.logger.log(`타겟 그룹 생성 완료: ${input.name}`);

      return {
        arn: targetGroup.TargetGroupArn || '',
        name: targetGroup.TargetGroupName || '',
        protocol: targetGroup.Protocol || '',
        port: targetGroup.Port || 0,
        vpcId: targetGroup.VpcId || '',
        targetType: targetGroup.TargetType || '',
        healthCheck: {
          protocol: targetGroup.HealthCheckProtocol || '',
          port: targetGroup.HealthCheckPort || '',
          path: targetGroup.HealthCheckPath,
          intervalSeconds: targetGroup.HealthCheckIntervalSeconds || 30,
          timeoutSeconds: targetGroup.HealthCheckTimeoutSeconds || 5,
          healthyThresholdCount: targetGroup.HealthyThresholdCount || 5,
          unhealthyThresholdCount: targetGroup.UnhealthyThresholdCount || 2,
          matcher: targetGroup.Matcher?.HttpCode,
        },
      };
    } catch (error) {
      this.logger.error(`타겟 그룹 생성 실패: ${error}`);
      throw new Error(`타겟 그룹 생성 실패: ${error}`);
    }
  }

  /**
   * 타겟 그룹 삭제
   * 지정된 타겟 그룹을 삭제합니다
   */
  async deleteTargetGroup(targetGroupArn: string): Promise<void> {
    try {
      const command = new DeleteTargetGroupCommand({
        TargetGroupArn: targetGroupArn,
      });

      await this.elbv2Client.send(command);
      this.logger.log(`타겟 그룹 삭제 완료: ${targetGroupArn}`);
    } catch (error) {
      this.logger.error(`타겟 그룹 삭제 실패: ${error}`);
      throw new Error(`타겟 그룹 삭제 실패: ${error}`);
    }
  }

  /**
   * 리스너 생성
   * 로드밸런서에서 특정 프로토콜과 포트로 들어오는 요청을 처리할 리스너를 생성합니다
   */
  async createListener(input: CreateListenerInput): Promise<ListenerInfo> {
    try {
      const defaultActions = input.defaultActions.map((action) => ({
        Type: action.type,
        TargetGroupArn: action.targetGroupArn,
        RedirectConfig: action.redirectConfig
          ? {
              Protocol: action.redirectConfig.protocol,
              Port: action.redirectConfig.port,
              Host: action.redirectConfig.host,
              Path: action.redirectConfig.path,
              Query: action.redirectConfig.query,
              StatusCode: RedirectActionStatusCodeEnum.HTTP_301,
            }
          : undefined,
        FixedResponseConfig: action.fixedResponseConfig
          ? {
              StatusCode: action.fixedResponseConfig.statusCode,
              ContentType: action.fixedResponseConfig.contentType,
              MessageBody: action.fixedResponseConfig.messageBody,
            }
          : undefined,
      }));

      const command = new CreateListenerCommand({
        LoadBalancerArn: input.loadBalancerArn,
        Protocol: input.protocol,
        Port: input.port,
        Certificates: input.certificateArns?.map((arn) => ({
          CertificateArn: arn,
        })),
        DefaultActions: defaultActions,
        Tags: input.tags?.map((tag) => ({
          Key: tag.key,
          Value: tag.value,
        })),
      });

      const result = await this.elbv2Client.send(command);
      const listener = result.Listeners?.[0];

      if (!listener) {
        throw new Error('리스너 생성 응답이 비어있습니다');
      }

      this.logger.log(`리스너 생성 완료: ${listener.ListenerArn}`);

      return {
        arn: listener.ListenerArn || '',
        loadBalancerArn: listener.LoadBalancerArn || '',
        protocol: listener.Protocol || '',
        port: listener.Port || 0,
        sslPolicy: listener.SslPolicy,
        certificates: listener.Certificates?.map((cert) => ({
          certificateArn: cert.CertificateArn || '',
          isDefault: cert.IsDefault,
        })),
        defaultActions:
          listener.DefaultActions?.map((action) => ({
            type: action.Type!,
            targetGroupArn: action.TargetGroupArn,
            redirectConfig: action.RedirectConfig
              ? {
                  protocol: action.RedirectConfig.Protocol,
                  port: action.RedirectConfig.Port,
                  host: action.RedirectConfig.Host,
                  path: action.RedirectConfig.Path,
                  query: action.RedirectConfig.Query,
                  statusCode: action.RedirectConfig.StatusCode || 'HTTP_301',
                }
              : undefined,
            fixedResponseConfig: action.FixedResponseConfig
              ? {
                  statusCode: action.FixedResponseConfig.StatusCode || '',
                  contentType: action.FixedResponseConfig.ContentType,
                  messageBody: action.FixedResponseConfig.MessageBody,
                }
              : undefined,
          })) || [],
      };
    } catch (error) {
      this.logger.error(`리스너 생성 실패: ${error}`);
      throw new Error(`리스너 생성 실패: ${error}`);
    }
  }

  /**
   * 리스너 삭제
   * 지정된 리스너를 삭제합니다
   */
  async deleteListener(listenerArn: string): Promise<void> {
    try {
      const command = new DeleteListenerCommand({
        ListenerArn: listenerArn,
      });

      await this.elbv2Client.send(command);
      this.logger.log(`리스너 삭제 완료: ${listenerArn}`);
    } catch (error) {
      this.logger.error(`리스너 삭제 실패: ${error}`);
      throw new Error(`리스너 삭제 실패: ${error}`);
    }
  }

  /**
   * 리스너 규칙 삭제
   * 지정된 리스너 규칙을 삭제합니다
   */
  async deleteListenerRule(ruleArn: string): Promise<void> {
    try {
      const command = new DeleteRuleCommand({
        RuleArn: ruleArn,
      });

      await this.elbv2Client.send(command);
      this.logger.log(`리스너 규칙 삭제 완료: ${ruleArn}`);
    } catch (error) {
      this.logger.error(`리스너 규칙 삭제 실패: ${error}`);
      throw new Error(`리스너 규칙 삭제 실패: ${error}`);
    }
  }

  /**
   * 타겟 등록
   * 타겟 그룹에 새로운 타겟을 등록합니다
   */
  async registerTargets(input: RegisterTargetsInput): Promise<void> {
    try {
      const targets = input.targets.map((target) => ({
        Id: target.id,
        Port: target.port,
        AvailabilityZone: target.availabilityZone,
      }));

      const command = new RegisterTargetsCommand({
        TargetGroupArn: input.targetGroupArn,
        Targets: targets,
      });

      await this.elbv2Client.send(command);
      this.logger.log(`타겟 등록 완료: ${input.targets.length}개`);
    } catch (error) {
      this.logger.error(`타겟 등록 실패: ${error}`);
      throw new Error(`타겟 등록 실패: ${error}`);
    }
  }

  /**
   * 타겟 등록 해제
   * 타겟 그룹에서 타겟을 제거합니다
   */
  async deregisterTargets(input: RegisterTargetsInput): Promise<void> {
    try {
      const targets = input.targets.map((target) => ({
        Id: target.id,
        Port: target.port,
        AvailabilityZone: target.availabilityZone,
      }));

      const command = new DeregisterTargetsCommand({
        TargetGroupArn: input.targetGroupArn,
        Targets: targets,
      });

      await this.elbv2Client.send(command);
      this.logger.log(`타겟 등록 해제 완료: ${input.targets.length}개`);
    } catch (error) {
      this.logger.error(`타겟 등록 해제 실패: ${error}`);
      throw new Error(`타겟 등록 해제 실패: ${error}`);
    }
  }

  /**
   * 단일 타겟을 타겟 그룹에 등록합니다
   * @param targetGroupArn - 타겟 그룹 ARN
   * @param target - 등록할 타겟 정보
   */
  async registerTarget(
    targetGroupArn: string,
    target: { id: string; port: number },
  ): Promise<void> {
    await this.registerTargets({
      targetGroupArn,
      targets: [target],
    });
  }

  /**
   * 단일 타겟을 타겟 그룹에서 해제합니다
   * @param targetGroupArn - 타겟 그룹 ARN
   * @param target - 해제할 타겟 정보
   */
  async deregisterTarget(
    targetGroupArn: string,
    target: { id: string; port: number },
  ): Promise<void> {
    await this.deregisterTargets({
      targetGroupArn,
      targets: [target],
    });
  }

  /**
   * 로드밸런서 목록 조회
   * 계정의 모든 로드밸런서를 조회합니다
   */
  async listLoadBalancers(): Promise<LoadBalancerInfo[]> {
    try {
      const command = new DescribeLoadBalancersCommand({});
      const result = await this.elbv2Client.send(command);

      const loadBalancers =
        result.LoadBalancers?.map((lb) => ({
          arn: lb.LoadBalancerArn || '',
          name: lb.LoadBalancerName || '',
          dnsName: lb.DNSName || '',
          canonicalHostedZoneId: lb.CanonicalHostedZoneId || '',
          state: lb.State?.Code || '',
          scheme: lb.Scheme || '',
          type: lb.Type || '',
          vpcId: lb.VpcId,
          availabilityZones:
            lb.AvailabilityZones?.map((az) => ({
              zoneName: az.ZoneName || '',
              subnetId: az.SubnetId || '',
            })) || [],
          securityGroups: lb.SecurityGroups || [],
          ipAddressType: lb.IpAddressType || '',
          createdTime: lb.CreatedTime,
        })) || [];

      this.logger.log(`로드밸런서 목록 조회 완료: ${loadBalancers.length}개`);
      return loadBalancers;
    } catch (error) {
      this.logger.error(`로드밸런서 목록 조회 실패: ${error}`);
      throw new Error(`로드밸런서 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 로드밸런서 목록 조회
   * 이름으로 로드밸런서를 조회합니다
   */
  async describeLoadBalancers(names?: string[]): Promise<LoadBalancerInfo[]> {
    try {
      const command = new DescribeLoadBalancersCommand({
        Names: names,
      });

      const result = await this.elbv2Client.send(command);

      const loadBalancers =
        result.LoadBalancers?.map((lb) => ({
          arn: lb.LoadBalancerArn || '',
          name: lb.LoadBalancerName || '',
          dnsName: lb.DNSName || '',
          canonicalHostedZoneId: lb.CanonicalHostedZoneId || '',
          scheme: lb.Scheme || '',
          vpcId: lb.VpcId || '',
          type: lb.Type || '',
          state: lb.State?.Code || '',
          createdTime: lb.CreatedTime || new Date(),
          ipAddressType: lb.IpAddressType || '',
          availabilityZones:
            lb.AvailabilityZones?.map((az) => ({
              zoneName: az.ZoneName || '',
              subnetId: az.SubnetId || '',
            })) || [],
          securityGroups: lb.SecurityGroups || [],
        })) || [];

      this.logger.log(`로드밸런서 목록 조회 완료: ${loadBalancers.length}개`);
      return loadBalancers;
    } catch (error) {
      this.logger.error(`로드밸런서 목록 조회 실패: ${error}`);
      throw new Error(`로드밸런서 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 서브넷 존재 여부 확인
   * EC2 API를 사용하여 서브넷이 실제로 존재하는지 확인합니다
   */
  private async verifySubnetsExist(subnetIds: string[]): Promise<void> {
    try {
      this.logger.log(`서브넷 검증 시작: ${JSON.stringify(subnetIds)}`);

      const command = new DescribeSubnetsCommand({
        SubnetIds: subnetIds,
      });

      const result = await this.ec2Client.send(command);

      if (!result.Subnets || result.Subnets.length !== subnetIds.length) {
        throw new Error(
          `일부 서브넷을 찾을 수 없습니다. 요청: ${subnetIds.length}개, 발견: ${result.Subnets?.length || 0}개`,
        );
      }

      // 서브넷 정보 로깅
      result.Subnets.forEach((subnet) => {
        this.logger.log(
          `✅ 서브넷 확인: ${subnet.SubnetId} - AZ: ${subnet.AvailabilityZone}, VPC: ${subnet.VpcId}, CIDR: ${subnet.CidrBlock}`,
        );
      });

      this.logger.log(`모든 서브넷이 검증되었습니다`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`서브넷 검증 실패: ${errorMessage}`);
      this.logger.error(`서브넷 ID: ${JSON.stringify(subnetIds)}`);
      this.logger.error(`에러 상세: ${JSON.stringify(error)}`);
      throw new Error(`서브넷 검증 실패: ${errorMessage}`);
    }
  }

  /**
   * 이름으로 ALB 검색
   * 모든 ALB를 조회한 후 이름으로 필터링합니다
   */
  async findLoadBalancerByName(name: string): Promise<LoadBalancerInfo | null> {
    try {
      // 이름으로 직접 검색 (더 효율적)
      const command = new DescribeLoadBalancersCommand({
        Names: [name],
      });
      const result = await this.elbv2Client.send(command);

      const loadBalancer = result.LoadBalancers?.[0];

      if (!loadBalancer) {
        return null;
      }

      return {
        arn: loadBalancer.LoadBalancerArn || '',
        name: loadBalancer.LoadBalancerName || '',
        dnsName: loadBalancer.DNSName || '',
        canonicalHostedZoneId: loadBalancer.CanonicalHostedZoneId || '',
        scheme: loadBalancer.Scheme || '',
        vpcId: loadBalancer.VpcId || '',
        type: loadBalancer.Type || '',
        state: loadBalancer.State?.Code || '',
        createdTime: loadBalancer.CreatedTime || new Date(),
        ipAddressType: loadBalancer.IpAddressType || '',
        availabilityZones:
          loadBalancer.AvailabilityZones?.map((az) => ({
            zoneName: az.ZoneName || '',
            subnetId: az.SubnetId || '',
          })) || [],
        securityGroups: loadBalancer.SecurityGroups || [],
      };
    } catch (error) {
      // LoadBalancerNotFound 에러는 정상적인 경우 (ALB가 없음)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const errorName = error?.name as string | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const errorCode = error?.Code as string | undefined;
      if (
        errorName === 'LoadBalancerNotFoundException' ||
        errorCode === 'LoadBalancerNotFound'
      ) {
        this.logger.log(`ALB가 존재하지 않음: ${name}`);
        return null;
      }
      this.logger.warn(`ALB 이름 검색 중 예외 발생: ${error}`);
      return null;
    }
  }

  /**
   * 타겟 그룹 목록 조회
   * 계정의 모든 타겟 그룹을 조회합니다
   */
  async listTargetGroups(): Promise<TargetGroupInfo[]> {
    try {
      const command = new DescribeTargetGroupsCommand({});
      const result = await this.elbv2Client.send(command);

      const targetGroups =
        result.TargetGroups?.map((tg) => ({
          arn: tg.TargetGroupArn || '',
          name: tg.TargetGroupName || '',
          protocol: tg.Protocol || '',
          port: tg.Port || 0,
          vpcId: tg.VpcId || '',
          targetType: tg.TargetType || '',
          healthCheck: {
            protocol: tg.HealthCheckProtocol || '',
            port: tg.HealthCheckPort || '',
            path: tg.HealthCheckPath,
            intervalSeconds: tg.HealthCheckIntervalSeconds || 30,
            timeoutSeconds: tg.HealthCheckTimeoutSeconds || 5,
            healthyThresholdCount: tg.HealthyThresholdCount || 5,
            unhealthyThresholdCount: tg.UnhealthyThresholdCount || 2,
            matcher: tg.Matcher?.HttpCode,
          },
        })) || [];

      this.logger.log(`타겟 그룹 목록 조회 완료: ${targetGroups.length}개`);
      return targetGroups;
    } catch (error) {
      this.logger.error(`타겟 그룹 목록 조회 실패: ${error}`);
      throw new Error(`타겟 그룹 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 타겟 헬스 상태 조회
   * 타겟 그룹의 모든 타겟 헬스 상태를 조회합니다
   */
  async getTargetHealth(targetGroupArn: string): Promise<TargetHealth[]> {
    try {
      const command = new DescribeTargetHealthCommand({
        TargetGroupArn: targetGroupArn,
      });

      const result = await this.elbv2Client.send(command);

      const targetHealths =
        result.TargetHealthDescriptions?.map((th) => ({
          target: {
            id: th.Target?.Id || '',
            port: th.Target?.Port,
            availabilityZone: th.Target?.AvailabilityZone,
          },
          healthState:
            (th.TargetHealth?.State as TargetHealthStateEnum) ||
            TargetHealthStateEnum.UNAVAILABLE,
          reason: th.TargetHealth?.Reason,
          description: th.TargetHealth?.Description,
        })) || [];

      this.logger.log(`타겟 헬스 상태 조회 완료: ${targetHealths.length}개`);
      return targetHealths;
    } catch (error) {
      this.logger.error(`타겟 헬스 상태 조회 실패: ${error}`);
      throw new Error(`타겟 헬스 상태 조회 실패: ${error}`);
    }
  }

  /**
   * 로드밸런서 속성 수정
   * 로드밸런서의 설정을 변경합니다
   */
  async modifyLoadBalancerAttributes(
    loadBalancerArn: string,
    attributes: { key: string; value: string }[],
  ): Promise<void> {
    try {
      const command = new ModifyLoadBalancerAttributesCommand({
        LoadBalancerArn: loadBalancerArn,
        Attributes: attributes.map((attr) => ({
          Key: attr.key,
          Value: attr.value,
        })),
      });

      await this.elbv2Client.send(command);
      this.logger.log(`로드밸런서 속성 수정 완료: ${loadBalancerArn}`);
    } catch (error) {
      this.logger.error(`로드밸런서 속성 수정 실패: ${error}`);
      throw new Error(`로드밸런서 속성 수정 실패: ${error}`);
    }
  }

  /**
   * 타겟 그룹 속성 수정
   * 타겟 그룹의 설정을 변경합니다
   */
  async modifyTargetGroupAttributes(
    targetGroupArn: string,
    attributes: { key: string; value: string }[],
  ): Promise<void> {
    try {
      const command = new ModifyTargetGroupAttributesCommand({
        TargetGroupArn: targetGroupArn,
        Attributes: attributes.map((attr) => ({
          Key: attr.key,
          Value: attr.value,
        })),
      });

      await this.elbv2Client.send(command);
      this.logger.log(`타겟 그룹 속성 수정 완료: ${targetGroupArn}`);
    } catch (error) {
      this.logger.error(`타겟 그룹 속성 수정 실패: ${error}`);
      throw new Error(`타겟 그룹 속성 수정 실패: ${error}`);
    }
  }

  /**
   * 리스너 규칙 생성
   * ALB 리스너에 라우팅 규칙을 추가합니다
   */
  async createListenerRule(input: CreateListenerRuleInput): Promise<{
    ruleArn: string;
    priority: number;
  }> {
    try {
      const command = new CreateRuleCommand({
        ListenerArn: input.listenerArn,
        Conditions: input.conditions.map((condition) => ({
          Field: condition.field,
          Values: condition.values,
        })),
        Actions: input.actions.map((action) => ({
          Type: action.type,
          TargetGroupArn: action.targetGroupArn,
          RedirectConfig: action.redirectConfig
            ? {
                Protocol: action.redirectConfig.protocol,
                Port: action.redirectConfig.port,
                Host: action.redirectConfig.host,
                Path: action.redirectConfig.path,
                Query: action.redirectConfig.query,
                StatusCode: RedirectActionStatusCodeEnum.HTTP_301,
              }
            : undefined,
          FixedResponseConfig: action.fixedResponseConfig
            ? {
                StatusCode: action.fixedResponseConfig.statusCode,
                ContentType: action.fixedResponseConfig.contentType,
                MessageBody: action.fixedResponseConfig.messageBody,
              }
            : undefined,
        })),
        Priority: input.priority,
      });

      const result = await this.elbv2Client.send(command);

      this.logger.log(`리스너 규칙 생성 완료: ${result.Rules?.[0]?.RuleArn}`);

      return {
        ruleArn: result.Rules?.[0]?.RuleArn || '',
        priority: result.Rules?.[0]?.Priority
          ? parseInt(result.Rules[0].Priority)
          : 0,
      };
    } catch (error) {
      this.logger.error(`리스너 규칙 생성 실패: ${error}`);
      throw new Error(`리스너 규칙 생성 실패: ${error}`);
    }
  }

  /**
   * 리스너 목록 조회
   * 로드밸런서의 모든 리스너를 조회합니다
   */
  async describeListeners(loadBalancerArn: string): Promise<ListenerInfo[]> {
    try {
      const command = new DescribeListenersCommand({
        LoadBalancerArn: loadBalancerArn,
      });

      const result = await this.elbv2Client.send(command);

      const listeners =
        result.Listeners?.map((listener) => ({
          arn: listener.ListenerArn || '',
          loadBalancerArn: listener.LoadBalancerArn || '',
          protocol: listener.Protocol || '',
          port: listener.Port || 0,
          defaultActions:
            listener.DefaultActions?.map((action) => ({
              type: (action.Type as ActionTypeEnum) || ActionTypeEnum.FORWARD,
              targetGroupArn: action.TargetGroupArn,
              redirectConfig: action.RedirectConfig
                ? {
                    protocol: action.RedirectConfig.Protocol,
                    port: action.RedirectConfig.Port,
                    host: action.RedirectConfig.Host,
                    path: action.RedirectConfig.Path,
                    query: action.RedirectConfig.Query,
                    statusCode:
                      (action.RedirectConfig
                        .StatusCode as RedirectActionStatusCodeEnum) ||
                      RedirectActionStatusCodeEnum.HTTP_301,
                  }
                : undefined,
              fixedResponseConfig: action.FixedResponseConfig
                ? {
                    statusCode: action.FixedResponseConfig.StatusCode || '',
                    contentType: action.FixedResponseConfig.ContentType,
                    messageBody: action.FixedResponseConfig.MessageBody,
                  }
                : undefined,
            })) || [],
        })) || [];

      this.logger.log(`리스너 목록 조회 완료: ${listeners.length}개`);
      return listeners;
    } catch (error) {
      this.logger.error(`리스너 목록 조회 실패: ${error}`);
      throw new Error(`리스너 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 리스너 규칙 목록 조회
   * 특정 리스너의 모든 규칙을 조회합니다
   */
  async describeRules(listenerArn: string): Promise<
    Array<{
      ruleArn: string;
      priority: string;
      conditions: Array<{
        field: string;
        values: string[];
      }>;
      actions: Array<{
        type: string;
        targetGroupArn?: string;
      }>;
    }>
  > {
    try {
      const command = new DescribeRulesCommand({
        ListenerArn: listenerArn,
      });

      const result = await this.elbv2Client.send(command);

      const rules =
        result.Rules?.map((rule) => ({
          ruleArn: rule.RuleArn || '',
          priority: rule.Priority || '',
          conditions:
            rule.Conditions?.map((condition) => ({
              field: condition.Field || '',
              values: condition.Values || [],
            })) || [],
          actions:
            rule.Actions?.map((action) => ({
              type: action.Type || '',
              targetGroupArn: action.TargetGroupArn,
            })) || [],
        })) || [];

      this.logger.log(`리스너 규칙 목록 조회 완료: ${rules.length}개`);
      return rules;
    } catch (error) {
      this.logger.error(`리스너 규칙 목록 조회 실패: ${error}`);
      throw new Error(`리스너 규칙 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 리스너 규칙 삭제
   * 특정 규칙을 삭제합니다
   */
  async deleteRule(ruleArn: string): Promise<void> {
    try {
      const command = new DeleteRuleCommand({
        RuleArn: ruleArn,
      });

      await this.elbv2Client.send(command);
      this.logger.log(`리스너 규칙 삭제 완료: ${ruleArn}`);
    } catch (error) {
      this.logger.error(`리스너 규칙 삭제 실패: ${error}`);
      throw new Error(`리스너 규칙 삭제 실패: ${error}`);
    }
  }

  /**
   * 리스너 규칙 수정
   * 기존 규칙의 액션과 조건을 업데이트합니다
   */
  async modifyRule(input: {
    ruleArn: string;
    actions: Array<{
      type: string;
      targetGroupArn: string;
    }>;
    conditions?: Array<{
      field: string;
      values: string[];
    }>;
  }): Promise<void> {
    try {
      const command = new ModifyRuleCommand({
        RuleArn: input.ruleArn,
        Actions: input.actions.map((action) => ({
          Type: ActionTypeEnum.FORWARD,
          TargetGroupArn: action.targetGroupArn,
        })),
        Conditions: input.conditions?.map((condition) => ({
          Field: condition.field,
          Values: condition.values,
        })),
      });

      await this.elbv2Client.send(command);
      this.logger.log(`리스너 규칙 수정 완료: ${input.ruleArn}`);
    } catch (error) {
      this.logger.error(`리스너 규칙 수정 실패: ${error}`);
      throw new Error(`리스너 규칙 수정 실패: ${error}`);
    }
  }

  /**
   * 호스트 헤더로 기존 규칙 찾기
   * 특정 호스트 헤더를 사용하는 규칙들을 찾습니다
   */
  async findRulesByHostHeader(
    listenerArn: string,
    hostHeader: string,
  ): Promise<
    Array<{
      ruleArn: string;
      priority: string;
    }>
  > {
    try {
      const rules = await this.describeRules(listenerArn);

      const matchingRules = rules.filter((rule) =>
        rule.conditions.some(
          (condition) =>
            condition.field === 'host-header' &&
            condition.values.includes(hostHeader),
        ),
      );

      this.logger.log(
        `호스트 헤더 ${hostHeader}에 대한 규칙 ${matchingRules.length}개 발견`,
      );

      return matchingRules.map((rule) => ({
        ruleArn: rule.ruleArn,
        priority: rule.priority,
      }));
    } catch (error) {
      this.logger.error(`호스트 헤더 규칙 검색 실패: ${error}`);
      throw new Error(`호스트 헤더 규칙 검색 실패: ${error}`);
    }
  }
}
