import {
  IpAddressType,
  LoadBalancerSchemeEnum,
  LoadBalancerTypeEnum,
  TargetTypeEnum,
  ProtocolEnum,
  ActionTypeEnum,
  TargetHealthStateEnum,
  RedirectActionStatusCodeEnum,
} from '@aws-sdk/client-elastic-load-balancing-v2';

/**
 * Application Load Balancer 생성을 위한 입력 타입
 */
export interface CreateLoadBalancerInput {
  /** 로드밸런서 이름 */
  name: string;
  /** 서브넷 ID 목록 (최소 2개의 가용영역) */
  subnets: string[];
  /** 보안 그룹 ID 목록 */
  securityGroups?: string[];
  /** 로드밸런서 스키마 (internet-facing 또는 internal) */
  scheme?: LoadBalancerSchemeEnum;
  /** 로드밸런서 타입 */
  type?: LoadBalancerTypeEnum;
  /** IP 주소 타입 */
  ipAddressType?: IpAddressType;
  /** 태그 */
  tags?: { key: string; value: string }[];
}

/**
 * 타겟 그룹 생성을 위한 입력 타입
 */
export interface CreateTargetGroupInput {
  /** 타겟 그룹 이름 */
  name: string;
  /** 프로토콜 */
  protocol: ProtocolEnum;
  /** 포트 번호 */
  port: number;
  /** VPC ID */
  vpcId: string;
  /** 타겟 타입 */
  targetType?: TargetTypeEnum;
  /** 헬스체크 설정 */
  healthCheck?: {
    /** 헬스체크 경로 */
    path?: string;
    /** 헬스체크 프로토콜 */
    protocol?: ProtocolEnum;
    /** 헬스체크 포트 */
    port?: string;
    /** 헬스체크 간격 (초) */
    intervalSeconds?: number;
    /** 타임아웃 (초) */
    timeoutSeconds?: number;
    /** 정상 임계값 */
    healthyThresholdCount?: number;
    /** 비정상 임계값 */
    unhealthyThresholdCount?: number;
    /** 성공 응답 코드 */
    matcher?: string;
  };
  /** 태그 */
  tags?: { key: string; value: string }[];
}

/**
 * 리스너 생성을 위한 입력 타입
 */
export interface CreateListenerInput {
  /** 로드밸런서 ARN */
  loadBalancerArn: string;
  /** 프로토콜 */
  protocol: ProtocolEnum;
  /** 포트 번호 */
  port: number;
  /** SSL 인증서 ARN 목록 (HTTPS의 경우) */
  certificateArns?: string[];
  /** 기본 액션 */
  defaultActions: ListenerAction[];
  /** 태그 */
  tags?: { key: string; value: string }[];
}

/**
 * 리스너 액션 타입
 */
export interface ListenerAction {
  /** 액션 타입 */
  type: ActionTypeEnum;
  /** 타겟 그룹 설정 (forward 액션의 경우) */
  targetGroupArn?: string;
  /** 리다이렉트 설정 (redirect 액션의 경우) */
  redirectConfig?: {
    protocol?: string;
    port?: string;
    host?: string;
    path?: string;
    query?: string;
    statusCode: RedirectActionStatusCodeEnum | string;
  };
  /** 고정 응답 설정 (fixed-response 액션의 경우) */
  fixedResponseConfig?: {
    statusCode: string;
    contentType?: string;
    messageBody?: string;
  };
}

/**
 * 리스너 규칙 생성을 위한 입력 타입
 */
export interface CreateListenerRuleInput {
  /** 리스너 ARN */
  listenerArn: string;
  /** 조건 목록 */
  conditions: ListenerRuleCondition[];
  /** 액션 목록 */
  actions: ListenerAction[];
  /** 우선순위 */
  priority: number;
  /** 태그 */
  tags?: { key: string; value: string }[];
}

/**
 * 리스너 규칙 조건 타입
 */
export interface ListenerRuleCondition {
  /** 조건 필드 */
  field: string;
  /** 조건 값 목록 */
  values: string[];
}

/**
 * 타겟 등록을 위한 입력 타입
 */
export interface RegisterTargetsInput {
  /** 타겟 그룹 ARN */
  targetGroupArn: string;
  /** 타겟 목록 */
  targets: Target[];
}

/**
 * 타겟 정보 타입
 */
export interface Target {
  /** 타겟 ID (인스턴스 ID, IP 주소 등) */
  id: string;
  /** 포트 번호 */
  port?: number;
  /** 가용영역 (IP 타겟의 경우) */
  availabilityZone?: string;
}

/**
 * 타겟 상태 정보 타입
 */
export interface TargetHealth {
  /** 타겟 정보 */
  target: Target;
  /** 타겟 헬스 상태 */
  healthState: TargetHealthStateEnum;
  /** 상태 이유 */
  reason?: string;
  /** 상태 설명 */
  description?: string;
}

/**
 * 로드밸런서 정보 타입
 */
export interface LoadBalancerInfo {
  /** 로드밸런서 ARN */
  arn: string;
  /** 로드밸런서 이름 */
  name: string;
  /** DNS 이름 */
  dnsName: string;
  /** 호스트존 ID */
  canonicalHostedZoneId: string;
  /** 상태 */
  state: string;
  /** 스키마 */
  scheme: string;
  /** 타입 */
  type: string;
  /** VPC ID */
  vpcId?: string;
  /** 가용영역 정보 */
  availabilityZones: Array<{
    zoneName: string;
    subnetId: string;
  }>;
  /** 보안 그룹 ID 목록 */
  securityGroups: string[];
  /** IP 주소 타입 */
  ipAddressType: string;
  /** 생성 시간 */
  createdTime?: Date;
}

/**
 * 타겟 그룹 정보 타입
 */
export interface TargetGroupInfo {
  /** 타겟 그룹 ARN */
  arn: string;
  /** 타겟 그룹 이름 */
  name: string;
  /** 프로토콜 */
  protocol: string;
  /** 포트 번호 */
  port: number;
  /** VPC ID */
  vpcId: string;
  /** 타겟 타입 */
  targetType: string;
  /** 헬스체크 설정 */
  healthCheck: {
    protocol: string;
    port: string;
    path?: string;
    intervalSeconds: number;
    timeoutSeconds: number;
    healthyThresholdCount: number;
    unhealthyThresholdCount: number;
    matcher?: string;
  };
}

/**
 * 리스너 정보 타입
 */
export interface ListenerInfo {
  /** 리스너 ARN */
  arn: string;
  /** 로드밸런서 ARN */
  loadBalancerArn: string;
  /** 프로토콜 */
  protocol: string;
  /** 포트 번호 */
  port: number;
  /** SSL 정책 */
  sslPolicy?: string;
  /** 인증서 목록 */
  certificates?: Array<{
    certificateArn: string;
    isDefault?: boolean;
  }>;
  /** 기본 액션 */
  defaultActions: ListenerAction[];
}