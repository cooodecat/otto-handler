import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Route53Client,
  CreateHostedZoneCommand,
  DeleteHostedZoneCommand,
  ChangeResourceRecordSetsCommand,
  CreateHealthCheckCommand,
  DeleteHealthCheckCommand,
  ListHostedZonesCommand,
  GetHostedZoneCommand,
  ListResourceRecordSetsCommand,
  ResourceRecordSet,
} from '@aws-sdk/client-route-53';
import {
  CreateHostedZoneInput,
  CreateRecordInput,
  CreateHealthCheckInput,
  BatchChangeInput,
  NameServerInfo,
} from './types/route53.types';

@Injectable()
export class AwsRoute53Service {
  private readonly logger = new Logger(AwsRoute53Service.name);
  private readonly route53Client: Route53Client;

  constructor(private configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';

    this.route53Client = new Route53Client({
      region,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        )!,
      },
    });
  }

  /**
   * 호스트존 생성
   * 도메인을 위한 DNS 호스트존을 생성합니다
   */
  async createHostedZone(input: CreateHostedZoneInput): Promise<{
    hostedZoneId: string;
    nameServers: string[];
    location: string;
  }> {
    try {
      const command = new CreateHostedZoneCommand({
        Name: input.name,
        CallerReference: `${Date.now()}-${Math.random()}`,
        HostedZoneConfig: {
          Comment: input.comment || `Hosted zone for ${input.name}`,
          PrivateZone: input.privateZone || false,
        },
        ...(input.vpc && {
          VPC: {
            VPCRegion: input.vpc.vpcRegion,
            VPCId: input.vpc.vpcId,
          },
        }),
        ...(input.tags && {
          Tags: input.tags.map((tag) => ({
            Key: tag.key,
            Value: tag.value,
          })),
        }),
      });

      const result = await this.route53Client.send(command);

      this.logger.log(`호스트존 생성 완료: ${input.name}`);

      return {
        hostedZoneId: result.HostedZone?.Id?.replace('/hostedzone/', '') || '',
        nameServers: result.DelegationSet?.NameServers || [],
        location: result.Location || '',
      };
    } catch (error) {
      this.logger.error(`호스트존 생성 실패: ${error}`);
      throw new Error(`호스트존 생성 실패: ${error}`);
    }
  }

  /**
   * 호스트존 삭제
   * 지정된 호스트존을 삭제합니다
   */
  async deleteHostedZone(hostedZoneId: string): Promise<void> {
    try {
      const command = new DeleteHostedZoneCommand({
        Id: hostedZoneId,
      });

      await this.route53Client.send(command);
      this.logger.log(`호스트존 삭제 완료: ${hostedZoneId}`);
    } catch (error) {
      this.logger.error(`호스트존 삭제 실패: ${error}`);
      throw new Error(`호스트존 삭제 실패: ${error}`);
    }
  }

  /**
   * DNS 레코드 생성
   * 호스트존에 새로운 DNS 레코드를 추가합니다
   */
  async createRecord(input: CreateRecordInput): Promise<{
    changeId: string;
    status: string;
  }> {
    try {
      const resourceRecordSet: ResourceRecordSet = {
        Name: input.name,
        Type: input.type,
        ...(input.setIdentifier && { SetIdentifier: input.setIdentifier }),
        ...(input.weight && { Weight: input.weight }),
        ...(input.region && { Region: input.region }),
        ...(input.failover && { Failover: input.failover }),
        ...(input.healthCheckId && { HealthCheckId: input.healthCheckId }),
        ...(input.aliasTarget
          ? {
              AliasTarget: {
                DNSName: input.aliasTarget.dnsName,
                HostedZoneId: input.aliasTarget.hostedZoneId,
                EvaluateTargetHealth:
                  input.aliasTarget.evaluateTargetHealth || false,
              },
            }
          : {
              TTL: input.ttl || 300,
              ResourceRecords:
                input.values?.map((value) => ({ Value: value })) || [],
            }),
      };

      const command = new ChangeResourceRecordSetsCommand({
        HostedZoneId: input.hostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: 'CREATE',
              ResourceRecordSet: resourceRecordSet,
            },
          ],
        },
      });

      const result = await this.route53Client.send(command);

      this.logger.log(`DNS 레코드 생성 완료: ${input.name} (${input.type})`);

      return {
        changeId: result.ChangeInfo?.Id || '',
        status: result.ChangeInfo?.Status || '',
      };
    } catch (error) {
      this.logger.error(`DNS 레코드 생성 실패: ${error}`);
      throw new Error(`DNS 레코드 생성 실패: ${error}`);
    }
  }

  /**
   * DNS 레코드 수정
   * 기존 DNS 레코드를 업데이트합니다
   */
  async updateRecord(input: CreateRecordInput): Promise<{
    changeId: string;
    status: string;
  }> {
    try {
      const resourceRecordSet: ResourceRecordSet = {
        Name: input.name,
        Type: input.type,
        ...(input.setIdentifier && { SetIdentifier: input.setIdentifier }),
        ...(input.weight && { Weight: input.weight }),
        ...(input.region && { Region: input.region }),
        ...(input.failover && { Failover: input.failover }),
        ...(input.healthCheckId && { HealthCheckId: input.healthCheckId }),
        ...(input.aliasTarget
          ? {
              AliasTarget: {
                DNSName: input.aliasTarget.dnsName,
                HostedZoneId: input.aliasTarget.hostedZoneId,
                EvaluateTargetHealth:
                  input.aliasTarget.evaluateTargetHealth || false,
              },
            }
          : {
              TTL: input.ttl || 300,
              ResourceRecords:
                input.values?.map((value) => ({ Value: value })) || [],
            }),
      };

      const command = new ChangeResourceRecordSetsCommand({
        HostedZoneId: input.hostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: 'UPSERT',
              ResourceRecordSet: resourceRecordSet,
            },
          ],
        },
      });

      const result = await this.route53Client.send(command);

      this.logger.log(`DNS 레코드 수정 완료: ${input.name} (${input.type})`);

      return {
        changeId: result.ChangeInfo?.Id || '',
        status: result.ChangeInfo?.Status || '',
      };
    } catch (error) {
      this.logger.error(`DNS 레코드 수정 실패: ${error}`);
      throw new Error(`DNS 레코드 수정 실패: ${error}`);
    }
  }

  /**
   * DNS 레코드 삭제
   * 지정된 DNS 레코드를 삭제합니다
   */
  async deleteRecord(input: CreateRecordInput): Promise<{
    changeId: string;
    status: string;
  }> {
    try {
      const resourceRecordSet: ResourceRecordSet = {
        Name: input.name,
        Type: input.type,
        ...(input.setIdentifier && { SetIdentifier: input.setIdentifier }),
        ...(input.weight && { Weight: input.weight }),
        ...(input.region && { Region: input.region }),
        ...(input.failover && { Failover: input.failover }),
        ...(input.healthCheckId && { HealthCheckId: input.healthCheckId }),
        ...(input.aliasTarget
          ? {
              AliasTarget: {
                DNSName: input.aliasTarget.dnsName,
                HostedZoneId: input.aliasTarget.hostedZoneId,
                EvaluateTargetHealth:
                  input.aliasTarget.evaluateTargetHealth || false,
              },
            }
          : {
              TTL: input.ttl || 300,
              ResourceRecords:
                input.values?.map((value) => ({ Value: value })) || [],
            }),
      };

      const command = new ChangeResourceRecordSetsCommand({
        HostedZoneId: input.hostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: 'DELETE',
              ResourceRecordSet: resourceRecordSet,
            },
          ],
        },
      });

      const result = await this.route53Client.send(command);

      this.logger.log(`DNS 레코드 삭제 완료: ${input.name} (${input.type})`);

      return {
        changeId: result.ChangeInfo?.Id || '',
        status: result.ChangeInfo?.Status || '',
      };
    } catch (error) {
      this.logger.error(`DNS 레코드 삭제 실패: ${error}`);
      throw new Error(`DNS 레코드 삭제 실패: ${error}`);
    }
  }

  /**
   * 배치 레코드 변경
   * 여러 DNS 레코드를 한 번에 변경합니다
   */
  async batchChangeRecords(input: BatchChangeInput): Promise<{
    changeId: string;
    status: string;
  }> {
    try {
      const changes = input.changes.map((change) => {
        const resourceRecordSet: ResourceRecordSet = {
          Name: change.resourceRecordSet.name,
          Type: change.resourceRecordSet.type,
          ...(change.resourceRecordSet.setIdentifier && {
            SetIdentifier: change.resourceRecordSet.setIdentifier,
          }),
          ...(change.resourceRecordSet.weight && {
            Weight: change.resourceRecordSet.weight,
          }),
          ...(change.resourceRecordSet.region && {
            Region: change.resourceRecordSet.region,
          }),
          ...(change.resourceRecordSet.failover && {
            Failover: change.resourceRecordSet.failover,
          }),
          ...(change.resourceRecordSet.healthCheckId && {
            HealthCheckId: change.resourceRecordSet.healthCheckId,
          }),
          ...(change.resourceRecordSet.aliasTarget
            ? {
                AliasTarget: {
                  DNSName: change.resourceRecordSet.aliasTarget.dnsName,
                  HostedZoneId:
                    change.resourceRecordSet.aliasTarget.hostedZoneId,
                  EvaluateTargetHealth:
                    change.resourceRecordSet.aliasTarget.evaluateTargetHealth ||
                    false,
                },
              }
            : {
                TTL: change.resourceRecordSet.ttl || 300,
                ResourceRecords:
                  change.resourceRecordSet.values?.map((value) => ({
                    Value: value,
                  })) || [],
              }),
        };

        return {
          Action: change.action,
          ResourceRecordSet: resourceRecordSet,
        };
      });

      const command = new ChangeResourceRecordSetsCommand({
        HostedZoneId: input.hostedZoneId,
        ChangeBatch: {
          Comment: input.comment,
          Changes: changes,
        },
      });

      const result = await this.route53Client.send(command);

      this.logger.log(`배치 레코드 변경 완료: ${input.changes.length}개 변경`);

      return {
        changeId: result.ChangeInfo?.Id || '',
        status: result.ChangeInfo?.Status || '',
      };
    } catch (error) {
      this.logger.error(`배치 레코드 변경 실패: ${error}`);
      throw new Error(`배치 레코드 변경 실패: ${error}`);
    }
  }

  /**
   * 헬스체크 생성
   * 리소스의 헬스체크를 생성합니다
   */
  async createHealthCheck(input: CreateHealthCheckInput): Promise<{
    healthCheckId: string;
    location: string;
  }> {
    try {
      const command = new CreateHealthCheckCommand({
        CallerReference: `${Date.now()}-${Math.random()}`,
        HealthCheckConfig: {
          Type: input.type,
          ...(input.fullyQualifiedDomainName && {
            FullyQualifiedDomainName: input.fullyQualifiedDomainName,
          }),
          ...(input.ipAddress && { IPAddress: input.ipAddress }),
          ...(input.port && { Port: input.port }),
          ...(input.resourcePath && { ResourcePath: input.resourcePath }),
          ...(input.requestInterval && {
            RequestInterval: input.requestInterval,
          }),
          ...(input.failureThreshold && {
            FailureThreshold: input.failureThreshold,
          }),
        },
      });

      const result = await this.route53Client.send(command);

      this.logger.log(`헬스체크 생성 완료: ${result.HealthCheck?.Id}`);

      return {
        healthCheckId: result.HealthCheck?.Id || '',
        location: result.Location || '',
      };
    } catch (error) {
      this.logger.error(`헬스체크 생성 실패: ${error}`);
      throw new Error(`헬스체크 생성 실패: ${error}`);
    }
  }

  /**
   * 헬스체크 삭제
   * 지정된 헬스체크를 삭제합니다
   */
  async deleteHealthCheck(healthCheckId: string): Promise<void> {
    try {
      const command = new DeleteHealthCheckCommand({
        HealthCheckId: healthCheckId,
      });

      await this.route53Client.send(command);
      this.logger.log(`헬스체크 삭제 완료: ${healthCheckId}`);
    } catch (error) {
      this.logger.error(`헬스체크 삭제 실패: ${error}`);
      throw new Error(`헬스체크 삭제 실패: ${error}`);
    }
  }

  /**
   * 호스트존 목록 조회
   * 계정의 모든 호스트존을 조회합니다
   */
  async listHostedZones(): Promise<{
    hostedZones: Array<{
      id: string;
      name: string;
      recordSetCount: number;
      privateZone: boolean;
      comment?: string;
    }>;
  }> {
    try {
      const command = new ListHostedZonesCommand({});
      const result = await this.route53Client.send(command);

      const hostedZones =
        result.HostedZones?.map((zone) => ({
          id: zone.Id?.replace('/hostedzone/', '') || '',
          name: zone.Name || '',
          recordSetCount: zone.ResourceRecordSetCount || 0,
          privateZone: zone.Config?.PrivateZone || false,
          comment: zone.Config?.Comment,
        })) || [];

      this.logger.log(`호스트존 목록 조회 완료: ${hostedZones.length}개`);

      return { hostedZones };
    } catch (error) {
      this.logger.error(`호스트존 목록 조회 실패: ${error}`);
      throw new Error(`호스트존 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 호스트존 상세 정보 조회
   * 특정 호스트존의 상세 정보를 조회합니다
   */
  async getHostedZone(hostedZoneId: string): Promise<NameServerInfo> {
    try {
      const command = new GetHostedZoneCommand({
        Id: hostedZoneId,
      });

      const result = await this.route53Client.send(command);

      this.logger.log(`호스트존 상세 정보 조회 완료: ${hostedZoneId}`);

      return {
        hostedZoneId: result.HostedZone?.Id?.replace('/hostedzone/', '') || '',
        nameServers: result.DelegationSet?.NameServers || [],
        domainName: result.HostedZone?.Name || '',
      };
    } catch (error) {
      this.logger.error(`호스트존 상세 정보 조회 실패: ${error}`);
      throw new Error(`호스트존 상세 정보 조회 실패: ${error}`);
    }
  }

  /**
   * DNS 레코드 목록 조회
   * 호스트존의 모든 DNS 레코드를 조회합니다
   */
  async listRecords(hostedZoneId: string): Promise<{
    records: Array<{
      name: string;
      type: string;
      ttl?: number;
      values?: string[];
      aliasTarget?: {
        dnsName: string;
        hostedZoneId: string;
      };
    }>;
  }> {
    try {
      const command = new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
      });

      const result = await this.route53Client.send(command);

      const records =
        result.ResourceRecordSets?.map((record) => ({
          name: record.Name || '',
          type: record.Type || '',
          ttl: record.TTL,
          values: record.ResourceRecords?.map((rr) => rr.Value || ''),
          ...(record.AliasTarget && {
            aliasTarget: {
              dnsName: record.AliasTarget.DNSName || '',
              hostedZoneId: record.AliasTarget.HostedZoneId || '',
            },
          }),
        })) || [];

      this.logger.log(`DNS 레코드 목록 조회 완료: ${records.length}개`);

      return { records };
    } catch (error) {
      this.logger.error(`DNS 레코드 목록 조회 실패: ${error}`);
      throw new Error(`DNS 레코드 목록 조회 실패: ${error}`);
    }
  }
}
