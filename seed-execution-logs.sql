-- Seed data for execution_log table
-- execution_id는 실제 execution 테이블의 ID를 사용해야 합니다

-- 첫 번째 execution (2da9fd32-9b23-4912-bbfe-de288112792d)의 로그
INSERT INTO execution_log (execution_id, timestamp, message, level, metadata, created_at) VALUES
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:31:57', '[Container] 2025/09/22 21:31:57 Waiting for agent ping', 'info', '{"phase": "PREPARING"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:31:58', '[Container] 2025/09/22 21:31:58 Waiting for DOWNLOAD_SOURCE', 'info', '{"phase": "PREPARING"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:31:59', '[Container] 2025/09/22 21:31:59 Phase is DOWNLOAD_SOURCE', 'info', '{"phase": "DOWNLOAD_SOURCE"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:00', '[Container] 2025/09/22 21:32:00 CODEBUILD_SRC_DIR=/codebuild/output/src', 'info', '{"phase": "DOWNLOAD_SOURCE"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:01', '[Container] 2025/09/22 21:32:01 Entering phase INSTALL', 'info', '{"phase": "INSTALL"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:02', '[Container] 2025/09/22 21:32:02 Running command echo "Installing dependencies..."', 'info', '{"phase": "INSTALL"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:02', 'Installing dependencies...', 'info', '{"phase": "INSTALL"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:03', '[Container] 2025/09/22 21:32:03 Running command npm install', 'info', '{"phase": "INSTALL"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:05', 'npm WARN deprecated package: some-old-package@1.0.0', 'warning', '{"phase": "INSTALL"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:10', 'added 350 packages from 220 contributors in 7.234s', 'info', '{"phase": "INSTALL"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:11', '[Container] 2025/09/22 21:32:11 Entering phase PRE_BUILD', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:12', '[Container] 2025/09/22 21:32:12 Running command echo "Running tests..."', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:12', 'Running tests...', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:13', '[Container] 2025/09/22 21:32:13 Running command npm test', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:15', 'PASS  src/utils/math.test.js', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:15', 'PASS  src/utils/string.test.js', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:16', 'Test Suites: 2 passed, 2 total', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:16', 'Tests: 10 passed, 10 total', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:17', '[Container] 2025/09/22 21:32:17 Entering phase BUILD', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:18', '[Container] 2025/09/22 21:32:18 Running command echo "Building application..."', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:18', 'Building application...', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:19', '[Container] 2025/09/22 21:32:19 Running command npm run build', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:20', '> otto-app@1.0.0 build /codebuild/output/src', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:20', '> webpack --mode production', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:25', 'Hash: 3a4f5g6h7j8k9l0m', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:25', 'Version: webpack 5.74.0', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:25', 'Build completed successfully', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:26', '[Container] 2025/09/22 21:32:26 Phase complete: BUILD State: RUNNING', 'info', '{"phase": "BUILD"}', NOW()),
('2da9fd32-9b23-4912-bbfe-de288112792d', '2025-09-22 21:32:26', '[Container] 2025/09/22 21:32:26 Entering phase POST_BUILD', 'info', '{"phase": "POST_BUILD"}', NOW());

-- 두 번째 execution (6c0cfd52-cef9-487a-9236-524c92c92af0)의 로그
INSERT INTO execution_log (execution_id, timestamp, message, level, metadata, created_at) VALUES
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:43', '[Container] 2025/09/22 21:08:43 Waiting for agent ping', 'info', '{"phase": "PREPARING"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:44', '[Container] 2025/09/22 21:08:44 Waiting for DOWNLOAD_SOURCE', 'info', '{"phase": "PREPARING"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:45', '[Container] 2025/09/22 21:08:45 Phase is DOWNLOAD_SOURCE', 'info', '{"phase": "DOWNLOAD_SOURCE"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:46', '[Container] 2025/09/22 21:08:46 CODEBUILD_SRC_DIR=/codebuild/output/src', 'info', '{"phase": "DOWNLOAD_SOURCE"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:47', '[Container] 2025/09/22 21:08:47 Entering phase INSTALL', 'info', '{"phase": "INSTALL"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:48', 'ERROR: npm install failed', 'error', '{"phase": "INSTALL"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:48', 'npm ERR! code ERESOLVE', 'error', '{"phase": "INSTALL"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:48', 'npm ERR! ERESOLVE unable to resolve dependency tree', 'error', '{"phase": "INSTALL"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:49', '[Container] 2025/09/22 21:08:49 Command did not exit successfully', 'error', '{"phase": "INSTALL"}', NOW()),
('6c0cfd52-cef9-487a-9236-524c92c92af0', '2025-09-22 21:08:49', '[Container] 2025/09/22 21:08:49 Phase complete: INSTALL State: FAILED', 'error', '{"phase": "INSTALL"}', NOW());

-- 세 번째 execution (5e1c9074-ef13-4357-a799-f7930e3b5b7f)의 로그
INSERT INTO execution_log (execution_id, timestamp, message, level, metadata, created_at) VALUES
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:03', '[Container] 2025/09/22 21:41:03 Waiting for agent ping', 'info', '{"phase": "PREPARING"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:04', '[Container] 2025/09/22 21:41:04 Waiting for DOWNLOAD_SOURCE', 'info', '{"phase": "PREPARING"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:05', '[Container] 2025/09/22 21:41:05 Phase is DOWNLOAD_SOURCE', 'info', '{"phase": "DOWNLOAD_SOURCE"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:06', '[Container] 2025/09/22 21:41:06 CODEBUILD_SRC_DIR=/codebuild/output/src', 'info', '{"phase": "DOWNLOAD_SOURCE"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:07', '[Container] 2025/09/22 21:41:07 Entering phase INSTALL', 'info', '{"phase": "INSTALL"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:08', 'Installing dependencies from cache...', 'info', '{"phase": "INSTALL"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:10', 'Dependencies installed successfully', 'info', '{"phase": "INSTALL"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:11', '[Container] 2025/09/22 21:41:11 Entering phase PRE_BUILD', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:12', 'Running linter...', 'info', '{"phase": "PRE_BUILD"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:13', 'Warning: ''console.log'' should not be used in production', 'warning', '{"phase": "PRE_BUILD"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:14', 'Linting completed with warnings', 'warning', '{"phase": "PRE_BUILD"}', NOW()),
('5e1c9074-ef13-4357-a799-f7930e3b5b7f', '2025-09-22 21:41:15', '[Container] 2025/09/22 21:41:15 Build is still running...', 'info', '{"phase": "BUILD"}', NOW());