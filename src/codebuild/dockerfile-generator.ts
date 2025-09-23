/**
 * Dockerfile 생성을 위한 헬퍼 함수
 */
export function generateDockerfileScript(
  nodeVersion: string = '20',
  packageManager: string = 'npm',
  buildCommand?: string,
): string {
  // Dockerfile 내용 구성
  const lines: string[] = [];

  lines.push(`FROM node:${nodeVersion}-alpine`);
  lines.push('WORKDIR /app');

  // package.json이 있을 때만 복사
  lines.push('COPY package*.json ./');

  if (packageManager === 'yarn') {
    lines.push('COPY yarn.lock* ./');
  } else if (packageManager === 'pnpm') {
    lines.push('COPY pnpm-lock.yaml* ./');
  }

  // 패키지 매니저 설치 및 의존성 설치 (package.json이 있을 때만)
  if (packageManager === 'npm') {
    lines.push(
      'RUN if [ -f package.json ]; then npm ci --only=production || npm install --only=production; fi',
    );
  } else if (packageManager === 'yarn') {
    lines.push('RUN npm install -g yarn');
    lines.push(
      'RUN if [ -f package.json ]; then yarn install --frozen-lockfile --production; fi',
    );
  } else if (packageManager === 'pnpm') {
    lines.push('RUN npm install -g pnpm');
    lines.push(
      'RUN if [ -f package.json ]; then pnpm install --frozen-lockfile --prod; fi',
    );
  }

  lines.push('COPY . .');

  // 빌드 명령어 (package.json이 있을 때만)
  if (buildCommand) {
    lines.push(`RUN if [ -f package.json ]; then ${buildCommand}; fi`);
  }

  lines.push('EXPOSE 3000');

  // 실행 명령어
  if (packageManager === 'npm') {
    lines.push('CMD ["npm", "start"]');
  } else if (packageManager === 'yarn') {
    lines.push('CMD ["yarn", "start"]');
  } else if (packageManager === 'pnpm') {
    lines.push('CMD ["pnpm", "start"]');
  }

  // 실제 줄바꿈 문자로 연결
  const dockerfileContent = lines.join('\n');

  // 전체를 하나의 명령어로 반환
  return `[ ! -f Dockerfile ] && echo "Creating Dockerfile..." && cat > Dockerfile << 'EODOCKERFILE'
${dockerfileContent}
EODOCKERFILE
[ -f Dockerfile ] && echo "Dockerfile created successfully" || echo "Using existing Dockerfile"`;
}
