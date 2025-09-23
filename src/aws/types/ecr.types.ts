import {
  ImageScanningConfiguration,
  EncryptionConfiguration,
  TagStatus,
} from '@aws-sdk/client-ecr';

/**
 * ECR 리포지토리 생성을 위한 입력 타입
 */
export interface CreateRepositoryInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 이미지 스캔 설정 */
  imageScanningConfiguration?: ImageScanningConfiguration;
  /** 암호화 설정 */
  encryptionConfiguration?: EncryptionConfiguration;
  /** 리포지토리에 적용할 태그 */
  tags?: { Key: string; Value: string }[];
}

/**
 * 이미지 태그 설정
 */
export interface ImageTag {
  /** 이미지 태그 */
  imageTag: string;
}

/**
 * 이미지 식별자
 */
export interface ImageIdentifier {
  /** 이미지 다이제스트 */
  imageDigest?: string;
  /** 이미지 태그 */
  imageTag?: string;
}

/**
 * 배치 이미지 삭제를 위한 입력 타입
 */
export interface BatchDeleteImageInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 삭제할 이미지 식별자 목록 */
  imageIds: ImageIdentifier[];
  /** 레지스트리 ID (선택사항) */
  registryId?: string;
}

/**
 * 이미지 업로드 정보 조회를 위한 입력 타입
 */
export interface GetAuthorizationTokenInput {
  /** 레지스트리 ID 목록 (선택사항) */
  registryIds?: string[];
}

/**
 * 리포지토리 이미지 목록 조회를 위한 입력 타입
 */
export interface ListImagesInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 레지스트리 ID (선택사항) */
  registryId?: string;
  /** 이미지 ID 필터 */
  filter?: {
    tagStatus?: TagStatus;
  };
  /** 최대 결과 수 */
  maxResults?: number;
  /** 다음 토큰 */
  nextToken?: string;
}

/**
 * 이미지 상세 정보 조회를 위한 입력 타입
 */
export interface DescribeImagesInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 이미지 ID 목록 (선택사항) */
  imageIds?: ImageIdentifier[];
  /** 레지스트리 ID (선택사항) */
  registryId?: string;
  /** 이미지 ID 필터 */
  filter?: {
    tagStatus?: TagStatus;
  };
  /** 최대 결과 수 */
  maxResults?: number;
  /** 다음 토큰 */
  nextToken?: string;
}

/**
 * 리포지토리 정책 설정을 위한 입력 타입
 */
export interface SetRepositoryPolicyInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 정책 텍스트 (JSON 문자열) */
  policyText: string;
  /** 레지스트리 ID (선택사항) */
  registryId?: string;
  /** 강제 적용 여부 */
  force?: boolean;
}

/**
 * 리포지토리 수명 주기 정책 설정을 위한 입력 타입
 */
export interface PutLifecyclePolicyInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 수명 주기 정책 텍스트 (JSON 문자열) */
  lifecyclePolicyText: string;
  /** 레지스트리 ID (선택사항) */
  registryId?: string;
}

/**
 * 배치 이미지 체크를 위한 입력 타입
 */
export interface BatchCheckLayerAvailabilityInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 레이어 다이제스트 목록 */
  layerDigests: string[];
  /** 레지스트리 ID (선택사항) */
  registryId?: string;
}

/**
 * 이미지 매니페스트 업로드를 위한 입력 타입
 */
export interface PutImageInput {
  /** 리포지토리 이름 */
  repositoryName: string;
  /** 이미지 매니페스트 */
  imageManifest: string;
  /** 이미지 태그 (선택사항) */
  imageTag?: string;
  /** 이미지 다이제스트 (선택사항) */
  imageDigest?: string;
  /** 레지스트리 ID (선택사항) */
  registryId?: string;
}
