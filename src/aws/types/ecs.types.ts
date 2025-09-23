import {
  TransportProtocol,
  LaunchType,
  AssignPublicIp,
  Compatibility,
  NetworkMode,
  LogDriver,
} from '@aws-sdk/client-ecs';

/**
 * ECS 클러스터 생성을 위한 입력 타입
 */
export interface CreateClusterInput {
  /** 클러스터 이름 */
  clusterName: string;
  /** 클러스터에 적용할 태그 */
  tags?: { key: string; value: string }[];
}

/**
 * 컨테이너 포트 매핑 설정
 */
export interface ContainerPortMapping {
  /** 컨테이너 포트 번호 */
  containerPort: number;
  /** 호스트 포트 번호 (선택사항) */
  hostPort?: number;
  /** 프로토콜 타입 */
  protocol?: TransportProtocol;
}

/**
 * 컨테이너 환경 변수
 */
export interface ContainerEnvironment {
  /** 환경 변수 이름 */
  name: string;
  /** 환경 변수 값 */
  value: string;
}

/**
 * 컨테이너 로그 설정
 */
export interface ContainerLogConfiguration {
  /** 로그 드라이버 (예: awslogs) */
  logDriver: LogDriver;
  /** 로그 드라이버별 옵션 */
  options?: Record<string, string>;
}

/**
 * 컨테이너 정의
 */
export interface ContainerDefinition {
  /** 컨테이너 이름 */
  name: string;
  /** 컨테이너 이미지 URI */
  image: string;
  /** 메모리 할당량 (MB) */
  memory?: number;
  /** CPU 할당량 */
  cpu?: number;
  /** 필수 컨테이너 여부 */
  essential?: boolean;
  /** 포트 매핑 설정 */
  portMappings?: ContainerPortMapping[];
  /** 환경 변수 */
  environment?: ContainerEnvironment[];
  /** 로그 설정 */
  logConfiguration?: ContainerLogConfiguration;
  /** 컨테이너 시작 명령어 */
  command?: string[];
}

/**
 * ECS 태스크 정의 생성을 위한 입력 타입
 */
export interface CreateTaskDefinitionInput {
  /** 태스크 정의 패밀리 이름 */
  family: string;
  /** 컨테이너 정의 목록 */
  containerDefinitions: ContainerDefinition[];
  /** 호환성 요구사항 (예: FARGATE, EC2) */
  requiresCompatibilities?: Compatibility[];
  /** 네트워크 모드 */
  networkMode?: NetworkMode;
  /** 태스크 레벨 CPU 할당량 */
  cpu?: string;
  /** 태스크 레벨 메모리 할당량 */
  memory?: string;
  /** 실행 역할 ARN */
  executionRoleArn?: string;
  /** 태스크 역할 ARN */
  taskRoleArn?: string;
}

/**
 * VPC 설정
 */
export interface AwsVpcConfiguration {
  /** 서브넷 ID 목록 */
  subnets: string[];
  /** 보안 그룹 ID 목록 */
  securityGroups?: string[];
  /** 퍼블릭 IP 할당 여부 */
  assignPublicIp?: AssignPublicIp;
}

/**
 * 네트워크 설정
 */
export interface NetworkConfiguration {
  /** VPC 설정 */
  awsvpcConfiguration?: AwsVpcConfiguration;
}

/**
 * 로드 밸런서 설정
 */
export interface LoadBalancer {
  /** 타겟 그룹 ARN */
  targetGroupArn?: string;
  /** 로드 밸런서 이름 */
  loadBalancerName?: string;
  /** 컨테이너 이름 */
  containerName: string;
  /** 컨테이너 포트 */
  containerPort: number;
}

/**
 * ECS 서비스 생성을 위한 입력 타입
 */
export interface CreateServiceInput {
  /** 서비스 이름 */
  serviceName: string;
  /** 클러스터 이름 또는 ARN */
  cluster: string;
  /** 태스크 정의 ARN */
  taskDefinition: string;
  /** 원하는 태스크 수 */
  desiredCount?: number;
  /** 런치 타입 */
  launchType?: LaunchType;
  /** 네트워크 설정 */
  networkConfiguration?: NetworkConfiguration;
  /** 로드 밸런서 설정 */
  loadBalancers?: LoadBalancer[];
}

/**
 * 컨테이너 오버라이드 설정
 */
export interface ContainerOverride {
  /** 컨테이너 이름 */
  name: string;
  /** 환경 변수 오버라이드 */
  environment?: ContainerEnvironment[];
  /** 명령어 오버라이드 */
  command?: string[];
}

/**
 * 태스크 오버라이드 설정
 */
export interface TaskOverrides {
  /** 컨테이너 오버라이드 목록 */
  containerOverrides?: ContainerOverride[];
}

/**
 * ECS 태스크 실행을 위한 입력 타입
 */
export interface RunTaskInput {
  /** 클러스터 이름 또는 ARN */
  cluster: string;
  /** 태스크 정의 ARN */
  taskDefinition: string;
  /** 실행할 태스크 수 */
  count?: number;
  /** 런치 타입 */
  launchType?: LaunchType;
  /** 네트워크 설정 */
  networkConfiguration?: NetworkConfiguration;
  /** 태스크 오버라이드 설정 */
  overrides?: TaskOverrides;
}