import { Injectable } from '@nestjs/common';
import { generateDockerfileScript } from './dockerfile-generator';

// Flow 노드 타입 인터페이스들 (frontend에서 가져온 타입)
interface AnyCICDNodeData {
  blockType: string;
  groupType: string;
  blockId: string;
  onSuccess: string | null;
  onFailed: string | null;
  [key: string]: any;
}

// BuildSpec 구조 인터페이스
interface BuildSpecPhase {
  commands: string[];
}

interface BuildSpec {
  version: string;
  phases: {
    pre_build: BuildSpecPhase;
    build: BuildSpecPhase;
    post_build: BuildSpecPhase;
  };
  artifacts?: {
    files: string[];
  };
}

@Injectable()
export class BuildSpecGeneratorService {
  /**
   * Flow 노드들을 buildspec.yml 문자열로 변환
   */
  generateBuildSpec(flowNodes: AnyCICDNodeData[]): string {
    // 디버깅: Flow 노드 정보 출력
    console.log('=== Flow Nodes Received ===');
    console.log(JSON.stringify(flowNodes, null, 2));
    console.log('=========================');

    // 기본 buildSpec 구조 생성
    const buildSpec: BuildSpec = {
      version: '0.2',
      phases: {
        pre_build: {
          commands: [
            // ECR 로그인
            'echo "=== PRE_BUILD Phase ==="',
            'echo Logging in to Amazon ECR...',
            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
            'REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME',
            'IMAGE_TAG=user-$USER_ID-project-$PROJECT_ID-build-$CODEBUILD_BUILD_NUMBER',
          ],
        },
        build: {
          commands: [
            'echo "=== BUILD Phase ==="',
            'echo Build started on `date`',
          ],
        },
        post_build: {
          commands: [
            'echo "=== POST_BUILD Phase ==="',
            'echo Build completed on `date`',
            'echo "=== Docker Push ==="',
            'echo Pushing the Docker images...',
            'docker push $REPOSITORY_URI:latest',
            'docker push $REPOSITORY_URI:$IMAGE_TAG',
            'echo Writing image definitions file...',
            'printf \'[{"name":"otto-container","imageUri":"%s"}]\' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json',
          ],
        },
      },
      artifacts: {
        files: ['imagedefinitions.json'],
      },
    };

    // Flow 노드들을 그룹별로 분류하여 처리
    const groupedNodes = this.groupNodesByType(flowNodes);

    // 1. Node.js 버전 설정 (node_version 노드가 있는 경우)
    const nodeVersionNode = flowNodes?.find(
      (node) => node?.blockType === 'node_version',
    );
    if (nodeVersionNode && nodeVersionNode.version) {
      buildSpec.phases.pre_build.commands.unshift(
        'echo "=== Node.js Setup ==="',
        'echo "Current Node version:"',
        'node --version',
        '# Check if n is installed',
        'which n || npm install -g n',
        `echo "Installing Node.js ${nodeVersionNode.version}..."`,
        `n ${nodeVersionNode.version}`,
        'echo "Updated Node version:"',
        'node --version',
      );
    }

    // 2. 패키지 매니저 설치 (install_module_node에서)
    const installNode = flowNodes?.find(
      (node) => node?.blockType === 'install_module_node',
    );
    const packageManager = installNode?.packageManager || 'npm';

    if (packageManager !== 'npm') {
      buildSpec.phases.pre_build.commands.push(
        `echo "Installing ${packageManager} globally..."`,
        `which ${packageManager} || npm install -g ${packageManager}`,
      );
    }

    // 3. PREBUILD 그룹 처리 (OS 패키지, 환경 설정 등)
    if (groupedNodes.prebuild) {
      for (const node of groupedNodes.prebuild) {
        // node_version은 이미 위에서 처리했으므로 건너뛰기
        if (node.blockType !== 'node_version') {
          buildSpec.phases.pre_build.commands.push(
            ...this.generatePreBuildCommands(node),
          );
        }
      }
    }

    // 4. Dockerfile 생성 명령어 (PRE_BUILD 마지막에 추가)
    const dockerfileCommands = this.generateDockerfileCommands(flowNodes);
    buildSpec.phases.pre_build.commands.push(
      'echo "=== Dockerfile Setup ==="',
      ...dockerfileCommands,
    );

    // 5. BUILD 그룹 처리 (패키지 설치, 빌드 등)
    if (groupedNodes.build) {
      for (const node of groupedNodes.build) {
        const buildCommands = this.generateBuildCommands(node);
        if (buildCommands.length > 0) {
          buildSpec.phases.build.commands.push(...buildCommands);
        }
      }
    }

    // 6. Docker 빌드 (빌드 페이즈 마지막)
    buildSpec.phases.build.commands.push(
      'echo "=== Docker Build ==="',
      'echo "Checking for Dockerfile..."',
      '[ -f Dockerfile ] && echo "Dockerfile found" || echo "Dockerfile NOT found"',
      'echo "Building Docker image..."',
      'docker build -t $REPOSITORY_URI:latest .',
      'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG',
    );

    // 7. 테스트 처리 (POST_BUILD 시작 부분)
    const testCommands: string[] = [];

    // TEST 그룹 처리
    if (groupedNodes.test) {
      for (const node of groupedNodes.test) {
        testCommands.push(...this.generateTestCommands(node));
      }
    }

    // UTILITY 그룹에서 test_custom 처리
    if (groupedNodes.utility) {
      for (const node of groupedNodes.utility) {
        if (node.blockType === 'test_custom') {
          testCommands.push(...this.generateCustomTestCommands(node));
        }
      }
    }

    // 테스트 명령어가 있으면 POST_BUILD 시작 부분에 추가
    if (testCommands.length > 0) {
      buildSpec.phases.post_build.commands.splice(
        2, // "echo Build completed" 다음에 삽입
        0,
        'echo "=== Running Tests ==="',
        ...testCommands,
      );
    }

    // NOTIFICATION 그룹 처리 (post_build 마지막에 추가)
    if (groupedNodes.notification) {
      for (const node of groupedNodes.notification) {
        buildSpec.phases.post_build.commands.push(
          ...this.generateNotificationCommands(node),
        );
      }
    }

    const buildSpecString = JSON.stringify(buildSpec, null, 2);

    // 디버깅: 생성된 buildspec 출력
    console.log('=== Generated BuildSpec ===');
    console.log(buildSpecString);
    console.log('=========================');

    return buildSpecString;
  }

  /**
   * Flow 노드들을 그룹별로 분류
   */
  private groupNodesByType(
    flowNodes: AnyCICDNodeData[],
  ): Record<string, AnyCICDNodeData[]> {
    const grouped: Record<string, AnyCICDNodeData[]> = {};

    for (const node of flowNodes) {
      const groupType = node.groupType;
      if (!grouped[groupType]) {
        grouped[groupType] = [];
      }
      grouped[groupType].push(node);
    }

    return grouped;
  }

  /**
   * PREBUILD 단계 명령어 생성
   */
  private generatePreBuildCommands(node: AnyCICDNodeData): string[] {
    switch (node.blockType) {
      case 'os_package':
        return this.generateOSPackageCommands(node);
      case 'node_version':
        return this.generateNodeVersionCommands(node);
      case 'environment_setup':
        return this.generateEnvironmentSetupCommands(node);
      default:
        return [];
    }
  }

  /**
   * BUILD 단계 명령어 생성
   */
  private generateBuildCommands(node: AnyCICDNodeData): string[] {
    switch (node.blockType) {
      case 'install_module_node':
        return this.generateInstallPackagesCommands(node);
      case 'build_webpack':
        return this.generateWebpackBuildCommands(node);
      case 'build_vite':
        return this.generateViteBuildCommands(node);
      case 'build_custom':
        return this.generateCustomBuildCommands(node);
      default:
        return [];
    }
  }

  /**
   * TEST 단계 명령어 생성
   */
  private generateTestCommands(node: AnyCICDNodeData): string[] {
    switch (node.blockType) {
      case 'test_jest':
        return this.generateJestTestCommands(node);
      case 'test_vitest':
        return this.generateVitestTestCommands(node);
      case 'test_mocha':
        return this.generateMochaTestCommands(node);
      case 'test_playwright':
        return this.generatePlaywrightTestCommands(node);
      case 'test_custom':
        return this.generateCustomTestCommands(node);
      default:
        return [];
    }
  }

  /**
   * NOTIFICATION 단계 명령어 생성
   */
  private generateNotificationCommands(node: AnyCICDNodeData): string[] {
    switch (node.blockType) {
      case 'notification_slack':
        return this.generateSlackNotificationCommands(node);
      case 'notification_email':
        return this.generateEmailNotificationCommands(node);
      default:
        return [];
    }
  }

  // ========== 개별 노드 타입별 명령어 생성 메서드들 ==========

  private generateOSPackageCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    const packageManager = node.packageManager || 'apt-get';

    // 패키지 매니저 타입 확인 및 설치
    if (node.updatePackageList) {
      if (packageManager === 'apt' || packageManager === 'apt-get') {
        commands.push('apt-get update -y');
      } else if (packageManager === 'yum') {
        commands.push('yum update -y');
      }
    }

    if (node.installPackages && node.installPackages.length > 0) {
      if (packageManager === 'apt' || packageManager === 'apt-get') {
        commands.push(`apt-get install -y ${node.installPackages.join(' ')}`);
      } else if (packageManager === 'yum') {
        commands.push(`yum install -y ${node.installPackages.join(' ')}`);
      }
    }

    return commands;
  }

  private generateNodeVersionCommands(node: AnyCICDNodeData): string[] {
    // node_version 노드는 메인 buildspec에서 처리하므로 비워둠
    // 기존 nvm 명령어는 사용하지 않음 (n 사용)
    return [];
  }

  private generateEnvironmentSetupCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];

    if (node.environmentVariables) {
      for (const [key, value] of Object.entries(node.environmentVariables)) {
        const envValue =
          typeof value === 'object' ? (value as any).value : value;
        commands.push(`export ${key}="${envValue}"`);
      }
    }

    if (node.loadFromFile) {
      commands.push(`source ${node.loadFromFile}`);
    }

    return commands;
  }

  private generateInstallPackagesCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    const packageManager = node.packageManager || 'npm';

    // 현재 디렉토리 확인
    commands.push('echo "=== Install Dependencies ==="');
    commands.push('pwd');
    commands.push('ls -la');
    commands.push('echo "Checking for package.json..."');
    commands.push(
      '[ -f package.json ] && cat package.json | head -20 || echo "No package.json found"',
    );

    // 패키지 매니저는 이미 PRE_BUILD에서 설치했으므로 여기서는 설치하지 않음

    let installCommand = '';
    if (node.cleanInstall) {
      if (packageManager === 'npm') {
        installCommand = 'npm ci || npm install'; // ci 실패시 install로 대체
      } else if (packageManager === 'yarn') {
        installCommand = 'yarn install --frozen-lockfile';
      } else if (packageManager === 'pnpm') {
        installCommand = 'pnpm install --frozen-lockfile';
      }
    } else {
      installCommand = node.productionOnly
        ? `${packageManager} install --production`
        : `${packageManager} install`;
    }

    // package.json이 있을 때만 설치, 없으면 건너뛰기
    commands.push(
      `if [ -f package.json ]; then echo "Installing dependencies with ${packageManager}..."; ${installCommand}; else echo "No package.json found, skipping dependency installation"; fi`,
    );

    return commands;
  }

  private generateWebpackBuildCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    const packageManager = node.packageManager || 'npm';

    // package.json이 있을 때만 실행
    let webpackCmd = '';
    if (node.configFile && node.configFile !== 'webpack.config.js') {
      if (packageManager === 'npm') {
        webpackCmd = `npx webpack --config ${node.configFile} --mode ${node.mode}`;
      } else if (packageManager === 'pnpm') {
        webpackCmd = `pnpm exec webpack --config ${node.configFile} --mode ${node.mode}`;
      } else if (packageManager === 'yarn') {
        webpackCmd = `yarn webpack --config ${node.configFile} --mode ${node.mode}`;
      }
    } else {
      if (packageManager === 'npm') {
        webpackCmd = `npx webpack --mode ${node.mode}`;
      } else if (packageManager === 'pnpm') {
        webpackCmd = `pnpm exec webpack --mode ${node.mode}`;
      } else if (packageManager === 'yarn') {
        webpackCmd = `yarn webpack --mode ${node.mode}`;
      }
    }

    commands.push(
      `if [ -f package.json ]; then echo "Running webpack build..."; ${webpackCmd}; else echo "No package.json found, skipping webpack build"; fi`,
    );

    return commands;
  }

  private generateViteBuildCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    const packageManager = node.packageManager || 'npm';

    // vite 명령어 구성
    let viteCmd = '';
    if (packageManager === 'npm') {
      viteCmd = 'npx vite build';
    } else if (packageManager === 'pnpm') {
      viteCmd = 'pnpm exec vite build';
    } else if (packageManager === 'yarn') {
      viteCmd = 'yarn vite build';
    }

    if (node.basePath && node.basePath !== '/') {
      commands.push(
        `if [ -f package.json ]; then echo "Running vite build..."; VITE_BASE_PATH=${node.basePath} ${viteCmd}; else echo "No package.json found, skipping vite build"; fi`,
      );
    } else {
      commands.push(
        `if [ -f package.json ]; then echo "Running vite build..."; ${viteCmd}; else echo "No package.json found, skipping vite build"; fi`,
      );
    }

    if (node.outputDir && node.outputDir !== 'dist') {
      commands.push(`mv ${node.outputDir} dist`);
    }

    return commands;
  }

  private generateCustomBuildCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    const packageManager = node.packageManager || 'npm';

    if (node.scriptName) {
      commands.push(`${packageManager} run ${node.scriptName}`);
    }

    if (node.customCommands && Array.isArray(node.customCommands)) {
      commands.push(...node.customCommands);
    }

    if (node.workingDirectory && node.workingDirectory !== '.') {
      return commands.map((cmd) => `cd ${node.workingDirectory} && ${cmd}`);
    }

    return commands;
  }

  private generateJestTestCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    let jestCmd = 'npm run test';

    if (node.configFile && node.configFile !== 'jest.config.js') {
      jestCmd += ` --config ${node.configFile}`;
    }

    if (node.coverage) {
      jestCmd += ' --coverage';
    }

    commands.push(jestCmd);
    return commands;
  }

  private generateVitestTestCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    let vitestCmd = 'npx vitest run';

    if (node.configFile && node.configFile !== 'vitest.config.ts') {
      vitestCmd += ` --config ${node.configFile}`;
    }

    if (node.coverage) {
      vitestCmd += ' --coverage';
    }

    commands.push(vitestCmd);
    return commands;
  }

  private generateMochaTestCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    let mochaCmd = 'npx mocha';

    if (node.testDir) {
      mochaCmd += ` ${node.testDir}`;
    }

    if (node.reporter) {
      mochaCmd += ` --reporter ${node.reporter}`;
    }

    if (node.timeout) {
      mochaCmd += ` --timeout ${node.timeout}`;
    }

    if (node.recursive) {
      mochaCmd += ' --recursive';
    }

    commands.push(mochaCmd);
    return commands;
  }

  private generatePlaywrightTestCommands(node: AnyCICDNodeData): string[] {
    const commands: string[] = [];
    let playwrightCmd = 'npx playwright test';

    if (node.configFile && node.configFile !== 'playwright.config.ts') {
      playwrightCmd += ` --config ${node.configFile}`;
    }

    if (node.browsers && Array.isArray(node.browsers)) {
      playwrightCmd += ` --project ${node.browsers.join(',')}`;
    }

    commands.push(playwrightCmd);
    return commands;
  }

  private generateCustomTestCommands(node: AnyCICDNodeData): string[] {
    if (node.testCommands && Array.isArray(node.testCommands)) {
      if (node.workingDirectory && node.workingDirectory !== '.') {
        return node.testCommands.map(
          (cmd: string) => `cd ${node.workingDirectory} && ${cmd}`,
        );
      }
      return node.testCommands;
    }
    return [];
  }

  private generateSlackNotificationCommands(node: AnyCICDNodeData): string[] {
    if (!node.channel || !node.webhookUrlEnv) {
      return [];
    }

    const message = node.messageTemplate || 'Build completed successfully!';
    return [
      `curl -X POST -H 'Content-type: application/json' --data '{"channel":"${node.channel}","text":"${message}"}' $${node.webhookUrlEnv}`,
    ];
  }

  private generateEmailNotificationCommands(node: AnyCICDNodeData): string[] {
    if (!node.recipients || !node.subject) {
      return [];
    }

    const message = node.messageTemplate || 'Build completed successfully!';
    return [`echo "${message}" | mail -s "${node.subject}" ${node.recipients}`];
  }

  /**
   * Dockerfile 생성 명령어 생성
   * 프로젝트에 Dockerfile이 없는 경우 기본 Dockerfile을 생성
   */
  private generateDockerfileCommands(flowNodes: AnyCICDNodeData[]): string[] {
    // Flow 노드에서 Node.js 버전 찾기 (기본값: 20)
    const nodeVersionNode = flowNodes?.find(
      (node) => node?.blockType === 'node_version',
    );
    const nodeVersion = nodeVersionNode?.version || '20';

    // Flow 노드에서 패키지 매니저 찾기 (기본값: npm)
    const installNode = flowNodes?.find(
      (node) => node?.blockType === 'install_module_node',
    );
    const packageManager = installNode?.packageManager || 'npm';

    // Flow 노드에서 빌드 명령어 찾기
    const buildNode = flowNodes?.find(
      (node) =>
        node?.blockType === 'build_webpack' ||
        node?.blockType === 'build_vite' ||
        node?.blockType === 'build_custom',
    );

    const buildCommand = buildNode
      ? this.getDockerBuildCommand(buildNode, packageManager)
      : undefined;

    // Dockerfile 생성 스크립트를 하나의 명령어로 반환
    const dockerfileScript = generateDockerfileScript(
      nodeVersion,
      packageManager,
      buildCommand,
    );

    return [dockerfileScript];
  }

  /**
   * Docker 빌드 명령어 생성 (Dockerfile 내부용)
   */
  private getDockerBuildCommand(
    buildNode: AnyCICDNodeData,
    packageManager: string,
  ): string {
    switch (buildNode.blockType) {
      case 'build_webpack':
        return `${packageManager} run build`;
      case 'build_vite':
        return `${packageManager} run build`;
      case 'build_custom':
        return buildNode.scriptName
          ? `${packageManager} run ${buildNode.scriptName}`
          : `${packageManager} run build`;
      default:
        return `${packageManager} run build`;
    }
  }
}
