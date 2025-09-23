import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ECRClient,
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  DescribeRepositoriesCommand,
  ListImagesCommand,
  DescribeImagesCommand,
  BatchDeleteImageCommand,
  GetAuthorizationTokenCommand,
  SetRepositoryPolicyCommand,
  GetRepositoryPolicyCommand,
  DeleteRepositoryPolicyCommand,
  PutLifecyclePolicyCommand,
  GetLifecyclePolicyCommand,
  DeleteLifecyclePolicyCommand,
  BatchCheckLayerAvailabilityCommand,
  PutImageCommand,
  BatchGetImageCommand,
} from '@aws-sdk/client-ecr';
import {
  CreateRepositoryInput,
  BatchDeleteImageInput,
  ListImagesInput,
  DescribeImagesInput,
  SetRepositoryPolicyInput,
  PutLifecyclePolicyInput,
  BatchCheckLayerAvailabilityInput,
  PutImageInput,
  ImageIdentifier,
} from './types/ecr.types';

/**
 * AWS ECR 서비스
 * ECR 리포지토리, 이미지, 정책을 관리하는 서비스
 */
@Injectable()
export class AwsEcrService {
  private ecrClient: ECRClient;

  constructor(private configService: ConfigService) {
    this.ecrClient = new ECRClient({
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
    });
  }

  /**
   * ECR 리포지토리를 생성합니다
   * @param input - 리포지토리 생성 입력 데이터
   * @returns 생성된 리포지토리 정보
   */
  async createRepository(input: CreateRepositoryInput) {
    const command = new CreateRepositoryCommand({
      repositoryName: input.repositoryName,
      imageScanningConfiguration: input.imageScanningConfiguration,
      encryptionConfiguration: input.encryptionConfiguration,
      tags: input.tags,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * ECR 리포지토리를 삭제합니다
   * @param repositoryName - 삭제할 리포지토리 이름
   * @param registryId - 레지스트리 ID (선택사항)
   * @param force - 이미지가 있어도 강제 삭제 여부
   * @returns 삭제된 리포지토리 정보
   */
  async deleteRepository(
    repositoryName: string,
    registryId?: string,
    force?: boolean,
  ) {
    const command = new DeleteRepositoryCommand({
      repositoryName,
      registryId,
      force,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * ECR 리포지토리 목록을 조회합니다
   * @param repositoryNames - 조회할 리포지토리 이름 목록 (선택사항)
   * @param registryId - 레지스트리 ID (선택사항)
   * @param maxResults - 최대 결과 수
   * @param nextToken - 다음 토큰
   * @returns 리포지토리 목록
   */
  async describeRepositories(
    repositoryNames?: string[],
    registryId?: string,
    maxResults?: number,
    nextToken?: string,
  ) {
    const command = new DescribeRepositoriesCommand({
      repositoryNames,
      registryId,
      maxResults,
      nextToken,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 리포지토리의 이미지 목록을 조회합니다
   * @param input - 이미지 목록 조회 입력 데이터
   * @returns 이미지 목록
   */
  async listImages(input: ListImagesInput) {
    const command = new ListImagesCommand({
      repositoryName: input.repositoryName,
      registryId: input.registryId,
      filter: input.filter,
      maxResults: input.maxResults,
      nextToken: input.nextToken,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 이미지의 상세 정보를 조회합니다
   * @param input - 이미지 상세 정보 조회 입력 데이터
   * @returns 이미지 상세 정보
   */
  async describeImages(input: DescribeImagesInput) {
    const command = new DescribeImagesCommand({
      repositoryName: input.repositoryName,
      imageIds: input.imageIds,
      registryId: input.registryId,
      filter: input.filter,
      maxResults: input.maxResults,
      nextToken: input.nextToken,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 여러 이미지를 일괄 삭제합니다
   * @param input - 배치 이미지 삭제 입력 데이터
   * @returns 삭제 결과
   */
  async batchDeleteImage(input: BatchDeleteImageInput) {
    const command = new BatchDeleteImageCommand({
      repositoryName: input.repositoryName,
      imageIds: input.imageIds,
      registryId: input.registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * ECR 인증 토큰을 가져옵니다
   * @param registryIds - 레지스트리 ID 목록 (선택사항, deprecated)
   * @returns 인증 토큰 정보
   */
  async getAuthorizationToken(registryIds?: string[]) {
    const command = new GetAuthorizationTokenCommand({
      ...(registryIds && { registryIds }),
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 리포지토리 정책을 설정합니다
   * @param input - 리포지토리 정책 설정 입력 데이터
   * @returns 설정된 정책 정보
   */
  async setRepositoryPolicy(input: SetRepositoryPolicyInput) {
    const command = new SetRepositoryPolicyCommand({
      repositoryName: input.repositoryName,
      policyText: input.policyText,
      registryId: input.registryId,
      force: input.force,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 리포지토리 정책을 조회합니다
   * @param repositoryName - 리포지토리 이름
   * @param registryId - 레지스트리 ID (선택사항)
   * @returns 리포지토리 정책
   */
  async getRepositoryPolicy(repositoryName: string, registryId?: string) {
    const command = new GetRepositoryPolicyCommand({
      repositoryName,
      registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 리포지토리 정책을 삭제합니다
   * @param repositoryName - 리포지토리 이름
   * @param registryId - 레지스트리 ID (선택사항)
   * @returns 삭제 결과
   */
  async deleteRepositoryPolicy(repositoryName: string, registryId?: string) {
    const command = new DeleteRepositoryPolicyCommand({
      repositoryName,
      registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 리포지토리 수명 주기 정책을 설정합니다
   * @param input - 수명 주기 정책 설정 입력 데이터
   * @returns 설정된 정책 정보
   */
  async putLifecyclePolicy(input: PutLifecyclePolicyInput) {
    const command = new PutLifecyclePolicyCommand({
      repositoryName: input.repositoryName,
      lifecyclePolicyText: input.lifecyclePolicyText,
      registryId: input.registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 리포지토리 수명 주기 정책을 조회합니다
   * @param repositoryName - 리포지토리 이름
   * @param registryId - 레지스트리 ID (선택사항)
   * @returns 수명 주기 정책
   */
  async getLifecyclePolicy(repositoryName: string, registryId?: string) {
    const command = new GetLifecyclePolicyCommand({
      repositoryName,
      registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 리포지토리 수명 주기 정책을 삭제합니다
   * @param repositoryName - 리포지토리 이름
   * @param registryId - 레지스트리 ID (선택사항)
   * @returns 삭제 결과
   */
  async deleteLifecyclePolicy(repositoryName: string, registryId?: string) {
    const command = new DeleteLifecyclePolicyCommand({
      repositoryName,
      registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 레이어 가용성을 일괄 확인합니다
   * @param input - 배치 레이어 확인 입력 데이터
   * @returns 레이어 가용성 정보
   */
  async batchCheckLayerAvailability(input: BatchCheckLayerAvailabilityInput) {
    const command = new BatchCheckLayerAvailabilityCommand({
      repositoryName: input.repositoryName,
      layerDigests: input.layerDigests,
      registryId: input.registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 이미지 매니페스트를 업로드합니다
   * @param input - 이미지 업로드 입력 데이터
   * @returns 업로드된 이미지 정보
   */
  async putImage(input: PutImageInput) {
    const command = new PutImageCommand({
      repositoryName: input.repositoryName,
      imageManifest: input.imageManifest,
      imageTag: input.imageTag,
      imageDigest: input.imageDigest,
      registryId: input.registryId,
    });

    return await this.ecrClient.send(command);
  }

  /**
   * 여러 이미지의 매니페스트를 일괄 조회합니다
   * @param repositoryName - 리포지토리 이름
   * @param imageIds - 이미지 ID 목록
   * @param registryId - 레지스트리 ID (선택사항)
   * @returns 이미지 매니페스트 목록
   */
  async batchGetImage(
    repositoryName: string,
    imageIds: ImageIdentifier[],
    registryId?: string,
  ) {
    const command = new BatchGetImageCommand({
      repositoryName,
      imageIds,
      registryId,
    });

    return await this.ecrClient.send(command);
  }
}
