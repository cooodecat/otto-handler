# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Otto-handler는 GitHub 통합 CI/CD 플랫폼의 핵심 백엔드 애플리케이션입니다. NestJS 11.x 기반으로 구축되었으며, AWS 서비스들을 오케스트레이션하여 자동화된 빌드 및 배포 파이프라인을 제공합니다.

## 기술 스택

### 핵심 프레임워크
- **NestJS 11.x** with Fastify adapter (Express 대신 성능 향상)
- **TypeScript 5.9** strict 모드
- **Nestia 8.0** - 타입 안전 API와 자동 SDK 생성
- **Typia 9.7** - 런타임 타입 검증
- **TypeORM 0.3** + PostgreSQL
- **Redis** - 캐싱 및 WebSocket 세션 관리
- **Socket.io 4.8** - 실시간 로그 스트리밍

### AWS 서비스 통합
- CodeBuild, ECS, ECR, CloudWatch Logs, S3, EventBridge, ALB, Route53
- Lambda 함수 (`/lambda/index.ts`) - EventBridge 이벤트 처리

## 주요 개발 명령어

```bash
# 개발 서버 시작 (포트 4000, 파일 감시 모드)
pnpm start:dev

# 디버거 연결하여 시작
pnpm start:debug

# 프로덕션 빌드
pnpm build

# 프로덕션 실행
pnpm start:prod

# 코드 품질 관리
pnpm lint              # ESLint 자동 수정
pnpm format            # Prettier 포맷팅

# 테스트
pnpm test              # 모든 유닛 테스트
pnpm test:watch        # 감시 모드로 테스트
pnpm test:cov          # 커버리지 리포트 생성
pnpm test:e2e          # E2E 테스트
pnpm test:debug        # 디버거로 테스트

# 특정 테스트 파일 실행
pnpm test -- auth.service.spec.ts
pnpm test -- logs.gateway.spec.ts

# SDK 생성 (중요!)
npx nestia sdk         # /sdk와 /otto-sdk에 SDK 생성
npx nestia swagger     # dist/swagger.json에 OpenAPI 스펙 생성

# 초기 설정 (ts-patch 설치 - Typia 필수)
pnpm prepare
```

## 코드 아키텍처

### 모듈 구조와 책임

```
src/
├── auth/                    # 인증 및 권한 관리
│   ├── auth.service        # JWT 토큰 관리, 사용자 인증
│   ├── github-oauth.service # GitHub OAuth 플로우
│   └── jwt.service         # 토큰 인코딩/디코딩, 리프레시 토큰 순환
│
├── user/                   # 사용자 관리
│   └── user.service        # GitHub 사용자 정보 관리
│
├── project/                # 프로젝트(리포지토리) 관리
│   └── project.service     # CodeBuild 프로젝트, ECR 리포지토리 생성/관리
│
├── pipeline/               # CI/CD 파이프라인 설정
│   └── pipeline.service    # 플로우 기반 파이프라인 정의, 배포 설정
│
├── execution/              # 파이프라인 실행 추적
│   └── execution.service   # 빌드/배포 실행, 상태 업데이트
│
├── logs/                   # 실시간 로깅 시스템
│   ├── logs.gateway        # WebSocket 게이트웨이 (실시간 로그 스트리밍)
│   ├── logs.service        # 로그 관리 및 저장
│   └── services/
│       ├── log-buffer.service      # 실시간 전송용 임시 로그 버퍼
│       ├── log-storage.service     # DB 영구 저장
│       └── cloudwatch-logs.service # CloudWatch 통합
│
├── github-app/             # GitHub App 통합
│   ├── github-app.service  # App 설치 관리
│   └── github-webhook.service # 웹훅 이벤트 처리
│
├── codebuild/              # AWS CodeBuild 통합
│   ├── codebuild.service   # 빌드 프로젝트 생성/실행
│   └── buildspec-generator.service # 플로우 노드 → buildspec.yml 변환
│
├── aws/                    # AWS 서비스 래퍼
│   ├── aws-ecs.service     # ECS 태스크/서비스 관리
│   ├── aws-ecr.service     # ECR 리포지토리, 이미지 관리
│   ├── aws-alb.service     # 로드 밸런서 관리
│   └── aws-route53.service # DNS 관리
│
└── database/
    ├── entities/           # TypeORM 엔티티
    └── seeders/            # 시드 데이터
```

### 데이터베이스 스키마

주요 엔티티:
- **User**: GitHub 사용자, OAuth 토큰
- **Project**: 리포지토리, CodeBuild 설정, ECR 정보
- **Pipeline**: CI/CD 파이프라인 정의, 플로우 데이터
- **Execution**: 실행 기록, 상태, AWS 빌드 ID
- **ExecutionLog**: 실시간 빌드 로그
- **RefreshToken**: JWT 리프레시 토큰 (보안 순환)
- **GitHubApp**: GitHub App 설치 정보

### API 패턴

#### Nestia 타입 안전 컨트롤러
```typescript
@Controller("project")
export class ProjectController {
  @TypedRoute.Post()
  async createProject(
    @TypedBody() body: CreateProjectDto
  ): Promise<ProjectResponseDto> {
    // Typia가 자동으로 런타임 검증
    return this.projectService.create(body);
  }
}
```

#### SDK 사용 패턴 (프론트엔드)
```typescript
import api from "@otto/sdk";
const project = await api.functional.project.createProject(connection, {
  projectName: "my-app",
  githubRepository: "user/repo"
});
```

### 인증 플로우

1. **GitHub OAuth**: 프론트엔드 시작 → 백엔드 콜백 → JWT 발급
2. **이중 토큰 시스템**:
   - Access Token: 15분, 짧은 수명
   - Refresh Token: 30일, DB 저장, 순환 메커니즘
3. **쿠키 보안**: httpOnly, secure(프로덕션), sameSite
4. **토큰 순환**: Grace period로 레이스 컨디션 방지

### 실시간 기능

#### WebSocket 로그 스트리밍
```typescript
// logs.gateway.ts
@WebSocketGateway({
  namespace: "logs",
  cors: { origin: true, credentials: true }
})
export class LogsGateway {
  @SubscribeMessage("subscribe-to-build")
  handleSubscribeToBuild(client: Socket, buildId: string) {
    client.join(`build-${buildId}`);
    // 버퍼된 로그 즉시 전송
    this.sendBufferedLogs(client, buildId);
  }
}
```

#### EventBridge 통합
- CodeBuild 상태 변경 → EventBridge → Lambda → Backend API
- 중복 이벤트 필터링 메커니즘

### AWS 리소스 네이밍 규칙

```
otto-{environment}-{projectId}-{resource}
예: otto-prod-abc123-codebuild
    otto-prod-abc123-ecr-repo
    otto-prod-abc123-ecs-service
```

## 환경 설정

### 필수 환경 변수 (.env)

```bash
# 데이터베이스
DATABASE_URL=postgresql://user:pass@localhost:5432/otto
REDIS_URL=redis://localhost:6379

# GitHub 통합
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_WEBHOOK_SECRET=webhook_secret
OTTO_GITHUB_OAUTH_CLIENT_ID=oauth_client_id
OTTO_GITHUB_OAUTH_SECRET=oauth_secret

# AWS (모두 필수)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_ACCOUNT_ID=123456789012
AWS_CODEBUILD_ROLE_ARN=arn:aws:iam::...
AWS_ECS_TASK_ROLE_ARN=arn:aws:iam::...
AWS_ECS_EXECUTION_ROLE_ARN=arn:aws:iam::...

# 보안
JWT_SECRET=jwt_secret_key
COOKIE_SECRET=cookie_secret_key

# 애플리케이션
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
PORT=4000
```

### 로컬 개발 환경 설정

```bash
# PostgreSQL과 Redis 시작 (Docker)
docker-compose up -d

# 데이터베이스 마이그레이션
pnpm typeorm migration:run

# 개발 서버 시작
pnpm start:dev
```

## 테스트 전략

### 유닛 테스트
- Jest + ts-jest 설정
- Service 격리를 위한 모킹
- WebSocket 테스트: `logs.gateway.spec.ts` 참조

### E2E 테스트
```bash
pnpm test:e2e
```

### 테스트 커버리지
```bash
pnpm test:cov
# 결과: /coverage/lcov-report/index.html
```

## CI/CD 파이프라인 아키텍처

### 플로우 기반 설정
1. 시각적 파이프라인 빌더 (프론트엔드)
2. JSON 플로우 데이터 → buildspec.yml 자동 생성
3. 다단계 빌드: Build → Test → Deploy

### CodeBuild 빌드스펙 생성
```typescript
// buildspec-generator.service.ts
generateBuildspec(flowData: FlowData): string {
  // 플로우 노드를 CodeBuild 명령어로 변환
  // 환경 변수, 아티팩트, 캐시 설정 포함
}
```

### ECS 배포
- Fargate 기반 컨테이너 배포
- Blue/Green 배포 전략
- ALB 헬스체크 통합

## 주요 서비스별 개발 가이드

### 새로운 API 엔드포인트 추가
1. DTO 생성 (Typia 타입 정의)
2. Controller 메서드 추가 (@TypedRoute 데코레이터)
3. Service 로직 구현
4. SDK 재생성: `npx nestia sdk`

### WebSocket 이벤트 추가
1. `logs.gateway.ts`에 새 핸들러 추가
2. `@SubscribeMessage('event-name')` 데코레이터 사용
3. 클라이언트 연결 관리 고려

### AWS 서비스 통합
1. AWS SDK v3 클라이언트 사용
2. 에러 처리 및 재시도 로직 구현
3. CloudWatch 로깅 추가

## 프로덕션 배포

### 배포 체크리스트
- [ ] 환경 변수 확인 (특히 AWS 자격증명)
- [ ] 데이터베이스 마이그레이션 실행
- [ ] Redis 연결 확인
- [ ] GitHub App 웹훅 URL 설정
- [ ] CORS origin 프로덕션 도메인 설정
- [ ] JWT/쿠키 시크릿 강력한 값으로 설정

### 모니터링
- CloudWatch Logs 로그 그룹: `/aws/otto/{environment}`
- ECS 서비스 메트릭
- ALB 타겟 헬스체크

## 디버깅 팁

### 로그 스트리밍 문제
```bash
# WebSocket 연결 테스트
curl http://localhost:4000/test-websocket

# Redis 연결 확인
redis-cli ping

# 로그 버퍼 상태 확인 (개발 모드)
GET /debug/log-buffer/:buildId
```

### CodeBuild 실행 문제
```bash
# buildspec 생성 확인
GET /debug/buildspec/:pipelineId

# CloudWatch 로그 직접 확인
aws logs tail /aws/codebuild/otto-dev-{projectId}
```

### 인증 문제
```bash
# JWT 토큰 디코딩
GET /debug/decode-token (개발 환경만)

# GitHub OAuth 상태 확인
GET /auth/github/status
```

## 팀 협업 가이드

### 한국어 문서
- `CodeBuild_구현_가이드.md` - CodeBuild 통합 상세 가이드
- `로그시스템_팀_협업가이드.md` - 로깅 시스템 협업 규칙

### 코드 리뷰 포인트
1. Typia 타입 검증 적용 여부
2. 에러 처리 및 로깅
3. AWS 리소스 정리 (cleanup) 로직
4. WebSocket 연결 누수 방지
5. 보안: 토큰, 시크릿 노출 금지

## 성능 최적화

### 데이터베이스
- TypeORM 쿼리 빌더 사용시 `.leftJoinAndSelect()` 주의 (N+1 문제)
- 인덱스 활용: executionId, buildId, timestamp

### WebSocket
- Redis adapter로 다중 인스턴스 지원
- 로그 버퍼링으로 과도한 이벤트 방지
- 연결당 구독 제한 (최대 10개 빌드)

### AWS API 호출
- SDK 클라이언트 재사용
- 배치 작업 활용 (예: ECR 이미지 일괄 삭제)
- CloudWatch Logs 쿼리 시간 범위 제한