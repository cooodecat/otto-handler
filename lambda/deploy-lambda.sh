#!/bin/bash

# Lambda 배포 스크립트
# Usage: ./deploy-lambda.sh [function-name] [region]

FUNCTION_NAME=${1:-"otto-eventbridge-handler"}
REGION=${2:-"ap-northeast-2"}
RUNTIME="nodejs18.x"
HANDLER="dist/index.handler"
TIMEOUT=30
MEMORY=256

echo "🚀 Building Lambda function..."

# Install dependencies
npm install

# Build TypeScript
npm run build

# Create deployment package
echo "📦 Creating deployment package..."
rm -f lambda-deployment.zip
zip -r lambda-deployment.zip dist/ node_modules/ -x "*.ts" -x "*.json" -x "*.sh"

echo "📤 Deploying to AWS Lambda..."

# Check if function exists
aws lambda get-function --function-name $FUNCTION_NAME --region $REGION > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "Updating existing function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://lambda-deployment.zip \
        --region $REGION
        
    echo "Updating function configuration..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --runtime $RUNTIME \
        --handler $HANDLER \
        --timeout $TIMEOUT \
        --memory-size $MEMORY \
        --environment "Variables={BACKEND_URL=$BACKEND_URL,API_KEY=$API_KEY}" \
        --region $REGION
else
    echo "Creating new function..."
    echo "Note: You need to create an IAM role first and provide the ARN"
    echo "Example: aws iam create-role --role-name otto-lambda-role --assume-role-policy-document file://trust-policy.json"
    echo "Then run: aws lambda create-function --function-name $FUNCTION_NAME --runtime $RUNTIME --role <ROLE_ARN> --handler $HANDLER --zip-file fileb://lambda-deployment.zip"
fi

echo "✅ Deployment complete!"
echo ""
echo "Don't forget to:"
echo "1. Set environment variables in Lambda console:"
echo "   - BACKEND_URL: Your backend API URL"
echo "   - API_KEY: Your API key for authentication"
echo "2. Configure EventBridge rule to trigger this Lambda"