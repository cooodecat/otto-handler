# Otto Backend (Handler)

GitHub과 AWS 서비스를 연결하는 Otto 플랫폼의 백엔드 API 서버입니다.

## 프로젝트 개요

Otto Backend는 복잡한 AWS 인프라를 API로 추상화하여, 사용자가 간단한 API 호출만으로 CI/CD 파이프라인을 구성하고 실행할 수 있도록 지원합니다.

### 핵심 기능

- **AWS 서비스 오케스트레이션**: CodeBuild, ECS, ECR 자동 관리
- **GitHub App 통합**: 리포지토리 연동 및 웹훅 처리
- **실시간 로그 스트리밍**: WebSocket 기반 빌드 로그 전송
- **인프라 자동화**: AWS 리소스 자동 프로비저닝

## 기술 스택

### Core Framework

- **NestJS 11.x**: 엔터프라이즈급 Node.js 프레임워크
- **Fastify**: 고성능 웹 서버 (Express 대비 2배 성능)
- **TypeScript 5.x**: 정적 타입 시스템

### Type Safety

- **Nestia 8.0**: 자동 SDK 생성 및 OpenAPI 스펙
- **Typia 9.7**: 컴파일 타임 타입 검증 및 런타임 벨리데이션

### Database

- **TypeORM 0.3**: 엔티티 기반 ORM
- **PostgreSQL**: 메인 데이터베이스 (JSONB 활용)
- **Redis**: 캐싱, 세션 관리, WebSocket 어댑터

### AWS SDK

- **@aws-sdk/client-codebuild**: CodeBuild 관리
- **@aws-sdk/client-ecs**: ECS 서비스 관리
- **@aws-sdk/client-ecr**: ECR 리포지토리 관리
- **@aws-sdk/client-eventbridge**: 이벤트 규칙 관리
- **@aws-sdk/client-cloudwatch-logs**: 로그 수집

### Real-time & Queue

- **Socket.io**: WebSocket 통신
- **Redis Adapter**: 분산 WebSocket 지원

### Authentication

- **JWT**: 액세스/리프레시 토큰
- **Passport**: OAuth 전략
- **bcrypt**: 비밀번호 암호화

## 프로젝트 구조

```
otto-handler/
├── src/
│   ├── auth/                        # 인증/인가 모듈
│   ├── user/                        # 사용자 관리
│   ├── project/                     # 프로젝트 관리
│   ├── pipeline/                    # CI/CD 파이프라인
│   ├── execution/                   # 빌드 실행 관리
│   ├── logs/                        # 로그 시스템 (WebSocket)
│   ├── deployment/                  # 배포 관리
│   ├── github-app/                  # GitHub App 통합
│   ├── aws/                         # AWS 서비스 래퍼
│   ├── database/                    # 데이터베이스 설정
│   ├── config/                      # 애플리케이션 설정
│   └── common/                      # 공통 모듈
├── lambda/                          # Lambda 함수
├── test/                            # 테스트
└── sdk/                             # Nestia SDK 출력
```

## 핵심 기능

### 1. CI/CD 파이프라인 관리

#### 파이프라인 생성 및 실행

- 시각적 플로우 데이터를 AWS CodeBuild buildspec으로 변환
- 다단계 빌드 프로세스 지원 (install, pre_build, build, post_build)
- 병렬 실행 및 조건부 분기 처리

#### 빌드 실행 관리

```typescript
// 빌드 시작
POST / api / v1 / pipelines / { pipelineId } / execute;

// 빌드 상태 조회
GET / api / v1 / executions / { executionId };

// 빌드 취소
POST / api / v1 / executions / { executionId } / cancel;
```

### 2. 실시간 로그 스트리밍

#### WebSocket 연결

```typescript
// Socket.io namespace: /logs
socket.emit('subscribe-to-build', buildId);
socket.on('build-log', (log) => {
  /* 로그 처리 */
});
socket.on('build-status-changed', (status) => {
  /* 상태 업데이트 */
});
```

#### 로그 처리 파이프라인

1. CloudWatch Logs 수집
2. EventBridge 이벤트 라우팅
3. Lambda 함수 처리
4. Backend API 수신
5. WebSocket 브로드캐스트
6. 비동기 DB 저장

### 3. GitHub 통합

#### GitHub App 기능

- 자동 웹훅 등록 및 처리
- 리포지토리별 권한 관리
- Pull Request 상태 업데이트
- 커밋 체크 실행

#### 웹훅 이벤트 처리

```typescript
POST /webhook/github
- push: 자동 빌드 트리거
- pull_request: PR 빌드 실행
- installation: App 설치 처리
```

### 4. AWS 리소스 관리

#### 자동 프로비저닝

- CodeBuild 프로젝트 생성/삭제
- ECR 리포지토리 관리
- ECS 태스크 정의 및 서비스 관리
- VPC, 서브넷, 보안 그룹 설정
- ALB 및 타겟 그룹 구성

#### 배포 전략

- 롤링 업데이트
- 헬스 체크 기반 자동 롤백

### 5. 인증 및 보안

#### JWT 토큰 시스템

- Access Token: 15분 유효
- Refresh Token: 30일 유효
- httpOnly 쿠키 사용
- 토큰 순환 메커니즘

#### 보안 기능

- GitHub OAuth 2.0
- Rate limiting
- CORS 정책
- 입력 검증 (Typia)

## API 문서

### Nestia SDK 생성

```bash
# SDK 생성 (프론트엔드용)
pnpm exec nestia sdk

# OpenAPI 스펙 생성
pnpm exec nestia swagger
```

### 주요 엔드포인트

모든 API 엔드포인트는 `/api/v1` 프리픽스를 사용합니다. Frontend SDK는 자동으로 이 프리픽스를 추가합니다.

#### 인증

```
POST   /api/v1/auth/github             - GitHub OAuth 시작
POST   /api/v1/auth/github/callback    - OAuth 콜백
POST   /api/v1/auth/refresh            - 토큰 갱신
POST   /api/v1/auth/logout             - 로그아웃
```

#### 프로젝트

```
GET    /api/v1/projects                - 프로젝트 목록
POST   /api/v1/projects                - 프로젝트 생성
GET    /api/v1/projects/{id}           - 프로젝트 상세
PUT    /api/v1/projects/{id}           - 프로젝트 수정
DELETE /api/v1/projects/{id}           - 프로젝트 삭제
```

#### 파이프라인

```
GET    /api/v1/pipelines               - 파이프라인 목록
POST   /api/v1/pipelines               - 파이프라인 생성
GET    /api/v1/pipelines/{id}          - 파이프라인 상세
PUT    /api/v1/pipelines/{id}          - 파이프라인 수정
DELETE /api/v1/pipelines/{id}          - 파이프라인 삭제
POST   /api/v1/pipelines/{id}/execute  - 파이프라인 실행
```

#### 실행 및 로그

```
GET    /api/v1/executions              - 실행 목록
GET    /api/v1/executions/{id}         - 실행 상세
GET    /api/v1/executions/{id}/logs    - 실행 로그
POST   /api/v1/executions/{id}/cancel  - 실행 취소
```

## 데이터베이스 설계

### 주요 엔티티

- **User**: GitHub OAuth로 인증된 사용자 정보
- **Project**: 사용자의 프로젝트, GitHub 리포지토리와 연결
- **Pipeline**: CI/CD 파이프라인 정의 (플로우 데이터, buildspec)
- **Execution**: 파이프라인 실행 기록 및 상태
- **ExecutionLog**: 실행 로그 (phase, step, level별 관리)

### 엔티티 관계

```
User        (1) ─── (N) Project
Project     (1) ─── (N) Pipeline
Pipeline    (1) ─── (N) Execution
Execution   (1) ─── (N) ExecutionLog
```

---

Otto Backend - 복잡한 배포를 간단하게 만드는 핵심 엔진
