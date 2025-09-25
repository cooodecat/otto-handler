import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  Subnet,
} from '@aws-sdk/client-ec2';
import {
  ECSClient,
  DescribeClustersCommand,
  CreateClusterCommand,
} from '@aws-sdk/client-ecs';
import {
  Route53Client,
  ListHostedZonesCommand,
} from '@aws-sdk/client-route-53';

interface InfrastructureConfig {
  cluster: {
    name: string;
    arn: string;
  };
  vpc: {
    id: string;
    cidrBlock: string;
  };
  subnets: Array<{
    id: string;
    availabilityZone: string;
    cidrBlock: string;
    public: boolean;
  }>;
  securityGroups: Array<{
    id: string;
    name: string;
  }>;
  route53: {
    hostedZoneId: string;
    domainName: string;
  };
}

@Injectable()
export class AwsInfrastructureService {
  private readonly logger = new Logger(AwsInfrastructureService.name);
  private readonly ec2Client: EC2Client;
  private readonly ecsClient: ECSClient;
  private readonly route53Client: Route53Client;
  private readonly region: string;

  // 캐시된 인프라 정보
  private cachedConfig: InfrastructureConfig | null = null;

  constructor(private configService: ConfigService) {
    this.region = this.configService.get<string>(
      'AWS_REGION',
      'ap-northeast-2',
    );

    const credentials = {
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
    };

    this.ec2Client = new EC2Client({
      region: this.region,
      credentials,
    });

    this.ecsClient = new ECSClient({
      region: this.region,
      credentials,
    });

    this.route53Client = new Route53Client({
      region: this.region,
      credentials,
    });
  }

  /**
   * 전체 인프라 구성 조회/생성
   * 캐싱 지원으로 성능 최적화
   */
  async getOrCreateInfrastructure(): Promise<InfrastructureConfig> {
    if (this.cachedConfig) {
      this.logger.debug('Using cached infrastructure configuration');
      return this.cachedConfig;
    }

    this.logger.log('🔍 Discovering AWS infrastructure...');

    // 1. VPC 및 네트워크 리소스 발견
    const networkConfig = await this.discoverNetworkResources();

    // 2. ECS 클러스터 발견/생성
    const clusterConfig = await this.getOrCreateEcsCluster();

    // 3. Route53 호스티드 존 발견
    const route53Config = await this.discoverRoute53Resources();

    this.cachedConfig = {
      cluster: clusterConfig,
      vpc: networkConfig.vpc,
      subnets: networkConfig.subnets,
      securityGroups: networkConfig.securityGroups,
      route53: route53Config,
    };

    this.logger.log('✅ Infrastructure configuration complete');
    this.logInfrastructureConfig(this.cachedConfig);

    return this.cachedConfig;
  }

  /**
   * VPC, 서브넷, 보안 그룹 자동 발견
   */
  private async discoverNetworkResources(): Promise<{
    vpc: InfrastructureConfig['vpc'];
    subnets: InfrastructureConfig['subnets'];
    securityGroups: InfrastructureConfig['securityGroups'];
  }> {
    this.logger.log('🔍 Discovering network resources...');

    // 1. VPC 발견 (기본 VPC 사용)
    const vpc = await this.discoverVpc();

    // 2. 퍼블릭 서브넷 발견
    const subnets = await this.discoverSubnets(vpc.id);

    // 3. 보안 그룹 발견/생성
    const securityGroups = await this.getOrCreateSecurityGroups(vpc.id);

    return { vpc, subnets, securityGroups };
  }

  /**
   * VPC 자동 발견 (기본 VPC 또는 첫 번째 사용 가능한 VPC)
   */
  private async discoverVpc(): Promise<InfrastructureConfig['vpc']> {
    try {
      const result = await this.ec2Client.send(new DescribeVpcsCommand({}));
      const vpcs = result.Vpcs || [];

      // 1. 기본 VPC 찾기
      let vpc = vpcs.find((v) => v.IsDefault === true);

      // 2. 기본 VPC가 없으면 첫 번째 사용 가능한 VPC
      if (!vpc) {
        vpc = vpcs.find((v) => v.State === 'available');
      }

      if (!vpc || !vpc.VpcId) {
        throw new Error('사용 가능한 VPC를 찾을 수 없습니다');
      }

      this.logger.log(
        `✅ VPC discovered: ${vpc.VpcId} (${vpc.IsDefault ? 'default' : 'custom'})`,
      );

      return {
        id: vpc.VpcId,
        cidrBlock: vpc.CidrBlock || 'unknown',
      };
    } catch (error) {
      this.logger.error(`VPC 조회 실패: ${error}`);
      throw new Error(`VPC 조회 실패: ${error}`);
    }
  }

  /**
   * 퍼블릭 서브넷 자동 발견
   */
  private async discoverSubnets(
    vpcId: string,
  ): Promise<InfrastructureConfig['subnets']> {
    try {
      const result = await this.ec2Client.send(
        new DescribeSubnetsCommand({
          Filters: [
            {
              Name: 'vpc-id',
              Values: [vpcId],
            },
            {
              Name: 'state',
              Values: ['available'],
            },
          ],
        }),
      );

      const subnets = result.Subnets || [];

      if (subnets.length === 0) {
        throw new Error(
          `VPC ${vpcId}에서 사용 가능한 서브넷을 찾을 수 없습니다`,
        );
      }

      // 퍼블릭 서브넷 우선 (MapPublicIpOnLaunch = true)
      const publicSubnets = subnets.filter(
        (s) => s.MapPublicIpOnLaunch === true,
      );
      const selectedSubnets =
        publicSubnets.length > 0 ? publicSubnets : subnets;

      // 최소 2개의 서브넷 선택 (서로 다른 AZ)
      const subnetsByAz = new Map<string, Subnet>();
      selectedSubnets.forEach((subnet) => {
        if (
          subnet.AvailabilityZone &&
          !subnetsByAz.has(subnet.AvailabilityZone)
        ) {
          subnetsByAz.set(subnet.AvailabilityZone, subnet);
        }
      });

      const finalSubnets = Array.from(subnetsByAz.values()).slice(0, 4); // 최대 4개

      this.logger.log(
        `✅ Discovered ${finalSubnets.length} subnets in ${finalSubnets.length} AZs`,
      );

      return finalSubnets.map((subnet) => ({
        id: subnet.SubnetId!,
        availabilityZone: subnet.AvailabilityZone!,
        cidrBlock: subnet.CidrBlock || 'unknown',
        public: subnet.MapPublicIpOnLaunch === true,
      }));
    } catch (error) {
      this.logger.error(`서브넷 조회 실패: ${error}`);
      throw new Error(`서브넷 조회 실패: ${error}`);
    }
  }

  /**
   * 보안 그룹 발견/생성 (Otto 전용)
   */
  private async getOrCreateSecurityGroups(
    vpcId: string,
  ): Promise<InfrastructureConfig['securityGroups']> {
    try {
      const ottoSgName = 'otto-deployment-sg';

      // 1. 기존 보안 그룹 확인
      const existingResult = await this.ec2Client.send(
        new DescribeSecurityGroupsCommand({
          Filters: [
            {
              Name: 'vpc-id',
              Values: [vpcId],
            },
            {
              Name: 'group-name',
              Values: [ottoSgName],
            },
          ],
        }),
      );

      if (
        existingResult.SecurityGroups &&
        existingResult.SecurityGroups.length > 0
      ) {
        const existingSg = existingResult.SecurityGroups[0];
        this.logger.log(
          `✅ Existing security group found: ${existingSg.GroupId}`,
        );

        return [
          {
            id: existingSg.GroupId!,
            name: existingSg.GroupName!,
          },
        ];
      }

      // 2. 새 보안 그룹 생성
      this.logger.log(`🏗️ Creating new security group: ${ottoSgName}`);

      const createResult = await this.ec2Client.send(
        new CreateSecurityGroupCommand({
          GroupName: ottoSgName,
          Description: 'Security group for Otto deployment services',
          VpcId: vpcId,
        }),
      );

      const newSgId = createResult.GroupId!;

      // 3. 인바운드 규칙 추가
      await this.ec2Client.send(
        new AuthorizeSecurityGroupIngressCommand({
          GroupId: newSgId,
          IpPermissions: [
            {
              IpProtocol: 'tcp',
              FromPort: 80,
              ToPort: 80,
              IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP access' }],
            },
            {
              IpProtocol: 'tcp',
              FromPort: 443,
              ToPort: 443,
              IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTPS access' }],
            },
            {
              IpProtocol: 'tcp',
              FromPort: 3000,
              ToPort: 3000,
              IpRanges: [
                { CidrIp: '10.0.0.0/8', Description: 'App port from VPC' },
              ],
            },
          ],
        }),
      );

      this.logger.log(`✅ Security group created: ${newSgId}`);

      return [
        {
          id: newSgId,
          name: ottoSgName,
        },
      ];
    } catch (error) {
      this.logger.error(`보안 그룹 생성 실패: ${error}`);
      throw new Error(`보안 그룹 생성 실패: ${error}`);
    }
  }

  /**
   * ECS 클러스터 발견/생성
   */
  private async getOrCreateEcsCluster(): Promise<
    InfrastructureConfig['cluster']
  > {
    try {
      const clusterName = this.configService.get<string>(
        'AWS_ECS_CLUSTER_NAME',
        'otto-cluster',
      );

      // 1. 기존 클러스터 확인
      const result = await this.ecsClient.send(
        new DescribeClustersCommand({
          clusters: [clusterName],
        }),
      );

      const existingCluster = result.clusters?.find(
        (c) => c.clusterName === clusterName && c.status === 'ACTIVE',
      );

      if (existingCluster) {
        this.logger.log(`✅ Existing ECS cluster found: ${clusterName}`);
        return {
          name: clusterName,
          arn: existingCluster.clusterArn!,
        };
      }

      // 2. 새 클러스터 생성
      this.logger.log(`🏗️ Creating new ECS cluster: ${clusterName}`);

      const createResult = await this.ecsClient.send(
        new CreateClusterCommand({
          clusterName,
          capacityProviders: ['FARGATE', 'FARGATE_SPOT'],
          defaultCapacityProviderStrategy: [
            {
              capacityProvider: 'FARGATE',
              weight: 1,
            },
          ],
          tags: [
            {
              key: 'Project',
              value: 'Otto',
            },
            {
              key: 'Environment',
              value: this.configService.get<string>('NODE_ENV', 'development'),
            },
          ],
        }),
      );

      this.logger.log(`✅ ECS cluster created: ${clusterName}`);

      return {
        name: clusterName,
        arn: createResult.cluster!.clusterArn!,
      };
    } catch (error) {
      this.logger.error(`ECS 클러스터 생성 실패: ${error}`);
      throw new Error(`ECS 클러스터 생성 실패: ${error}`);
    }
  }

  /**
   * Route53 호스티드 존 자동 발견
   */
  private async discoverRoute53Resources(): Promise<
    InfrastructureConfig['route53']
  > {
    try {
      const targetDomain = this.configService.get<string>(
        'ROUTE53_DOMAIN_NAME',
        'codecat-otto.shop',
      );

      const result = await this.route53Client.send(
        new ListHostedZonesCommand({}),
      );
      const hostedZones = result.HostedZones || [];

      const matchedZone = hostedZones.find(
        (zone) =>
          zone.Name === `${targetDomain}.` || zone.Name === targetDomain,
      );

      if (!matchedZone) {
        this.logger.warn(
          `Route53 hosted zone not found for domain: ${targetDomain}`,
        );
        this.logger.warn('Please create a hosted zone manually in Route53');

        // 기본값 반환 (수동 설정 필요)
        return {
          hostedZoneId: 'MANUAL_SETUP_REQUIRED',
          domainName: targetDomain,
        };
      }

      const zoneId = matchedZone.Id?.replace('/hostedzone/', '') || '';

      this.logger.log(
        `✅ Route53 hosted zone found: ${targetDomain} (${zoneId})`,
      );

      return {
        hostedZoneId: zoneId,
        domainName: targetDomain,
      };
    } catch (error) {
      this.logger.error(`Route53 호스티드 존 조회 실패: ${error}`);

      // Route53 오류는 치명적이지 않으므로 기본값 반환
      return {
        hostedZoneId: 'MANUAL_SETUP_REQUIRED',
        domainName: this.configService.get<string>(
          'ROUTE53_DOMAIN_NAME',
          'codecat-otto.shop',
        ),
      };
    }
  }

  /**
   * 캐시 무효화 (리소스 변경 시 사용)
   */
  invalidateCache(): void {
    this.cachedConfig = null;
    this.logger.log('Infrastructure cache invalidated');
  }

  /**
   * 인프라 구성 로깅
   */
  private logInfrastructureConfig(config: InfrastructureConfig): void {
    this.logger.log('📋 Infrastructure Configuration:');
    this.logger.log(`   🏗️  ECS Cluster: ${config.cluster.name}`);
    this.logger.log(`   🌐 VPC: ${config.vpc.id} (${config.vpc.cidrBlock})`);
    this.logger.log(
      `   🔗 Subnets: ${config.subnets.length} across ${new Set(config.subnets.map((s) => s.availabilityZone)).size} AZs`,
    );
    this.logger.log(
      `   🔒 Security Groups: ${config.securityGroups.map((sg) => sg.name).join(', ')}`,
    );
    this.logger.log(
      `   📍 Route53: ${config.route53.domainName} (${config.route53.hostedZoneId})`,
    );
  }
}
