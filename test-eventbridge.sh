#!/bin/bash

# EventBridge Integration Test Script

API_URL="http://localhost:4000"
API_KEY="local-dev-key"

echo "🧪 Testing EventBridge Integration..."
echo ""

# Test 1: Health check
echo "1️⃣ Testing EventBridge endpoint health..."
curl -s -X POST "$API_URL/api/v1/events/test" \
  -H "Content-Type: application/json" | jq '.'

echo ""
echo "2️⃣ Testing duplicate check endpoint..."
curl -s -X POST "$API_URL/api/v1/events/check" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"eventId": "test-event-'$(date +%s)'"}' | jq '.'

echo ""
echo "3️⃣ Simulating CodeBuild IN_PROGRESS event..."
EVENT_ID="test-event-$(date +%s)"
BUILD_ID="test-build:$(date +%s)"

curl -s -X POST "$API_URL/api/v1/events/process" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "id": "'$EVENT_ID'",
    "version": "0",
    "account": "123456789012",
    "time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "region": "ap-northeast-2",
    "source": "aws.codebuild",
    "resources": ["arn:aws:codebuild:ap-northeast-2:123456789012:build/'$BUILD_ID'"],
    "detail-type": "CodeBuild Build State Change",
    "detail": {
      "build-status": "IN_PROGRESS",
      "build-id": "'$BUILD_ID'",
      "project-name": "test-project",
      "current-phase": "SUBMITTED",
      "current-phase-context": "[]",
      "additional-information": {
        "build-number": 1,
        "initiator": "test-user",
        "start-time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
      }
    }
  }' | jq '.'

echo ""
echo "4️⃣ Testing duplicate event (should be rejected)..."
curl -s -X POST "$API_URL/api/v1/events/process" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "id": "'$EVENT_ID'",
    "version": "0",
    "account": "123456789012",
    "time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "region": "ap-northeast-2",
    "source": "aws.codebuild",
    "resources": ["arn:aws:codebuild:ap-northeast-2:123456789012:build/'$BUILD_ID'"],
    "detail-type": "CodeBuild Build State Change",
    "detail": {
      "build-status": "IN_PROGRESS",
      "build-id": "'$BUILD_ID'",
      "project-name": "test-project"
    }
  }' | jq '.'

echo ""
echo "5️⃣ Simulating CodeBuild SUCCEEDED event..."
EVENT_ID_2="test-event-$(date +%s)-2"

curl -s -X POST "$API_URL/api/v1/events/process" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "id": "'$EVENT_ID_2'",
    "version": "0",
    "account": "123456789012",
    "time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "region": "ap-northeast-2",
    "source": "aws.codebuild",
    "resources": ["arn:aws:codebuild:ap-northeast-2:123456789012:build/'$BUILD_ID'"],
    "detail-type": "CodeBuild Build State Change",
    "detail": {
      "build-status": "SUCCEEDED",
      "build-id": "'$BUILD_ID'",
      "project-name": "test-project",
      "current-phase": "COMPLETED",
      "additional-information": {
        "build-complete": true,
        "end-time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
      }
    }
  }' | jq '.'

echo ""
echo "✅ EventBridge integration test complete!"