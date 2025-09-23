import {
  RRType,
  ResourceRecordSetFailover,
  ResourceRecordSetRegion,
  VPCRegion,
} from '@aws-sdk/client-route-53';

/**
 * Route53 호스트존 생성을 위한 입력 타입
 */
export interface CreateHostedZoneInput {
  /** 도메인 이름 */
  name: string;
  /** VPC 설정 (프라이빗 호스트존인 경우) */
  vpc?: {
    vpcRegion: VPCRegion;
    vpcId: string;
  };
  /** 호스트존 설명 */
  comment?: string;
  /** 프라이빗 호스트존 여부 */
  privateZone?: boolean;
  /** 태그 */
  tags?: { key: string; value: string }[];
}

/**
 * DNS 레코드 생성을 위한 입력 타입
 */
export interface CreateRecordInput {
  /** 호스트존 ID */
  hostedZoneId: string;
  /** 레코드 이름 */
  name: string;
  /** 레코드 타입 */
  type: RRType;
  /** TTL (Time To Live) */
  ttl?: number;
  /** 리소스 레코드 값들 */
  values?: string[];
  /** ALB/CloudFront 등의 별칭 설정 */
  aliasTarget?: {
    dnsName: string;
    hostedZoneId: string;
    evaluateTargetHealth?: boolean;
  };
  /** 가중치 기반 라우팅 */
  weight?: number;
  /** 지연 시간 기반 라우팅 */
  region?: ResourceRecordSetRegion;
  /** 장애 조치 라우팅 */
  failover?: ResourceRecordSetFailover;
  /** 헬스체크 ID */
  healthCheckId?: string;
  /** 라우팅 정책 식별자 */
  setIdentifier?: string;
}

/**
 * 헬스체크 생성을 위한 입력 타입
 */
export interface CreateHealthCheckInput {
  /** 헬스체크 타입 */
  type: 'HTTP' | 'HTTPS' | 'TCP';
  /** 대상 도메인 또는 IP */
  fullyQualifiedDomainName?: string;
  /** IP 주소 */
  ipAddress?: string;
  /** 포트 번호 */
  port?: number;
  /** 리소스 경로 (HTTP/HTTPS) */
  resourcePath?: string;
  /** 요청 간격 (초) */
  requestInterval?: 30 | 10;
  /** 실패 임계값 */
  failureThreshold?: number;
  /** 헬스체크 태그 */
  tags?: { key: string; value: string }[];
}

/**
 * Route53 레코드 배치 변경을 위한 입력 타입
 */
export interface BatchChangeInput {
  /** 호스트존 ID */
  hostedZoneId: string;
  /** 변경 사항들 */
  changes: {
    action: 'CREATE' | 'DELETE' | 'UPSERT';
    resourceRecordSet: CreateRecordInput;
  }[];
  /** 변경 사항 설명 */
  comment?: string;
}

/**
 * 도메인 위임을 위한 네임서버 정보
 */
export interface NameServerInfo {
  /** 호스트존 ID */
  hostedZoneId: string;
  /** 네임서버 목록 */
  nameServers: string[];
  /** 도메인 이름 */
  domainName: string;
}
