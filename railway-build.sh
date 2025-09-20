#!/bin/bash

# Build the application
echo "Building application..."
pnpm build

# Auto sync database schema in production
echo "Syncing database schema..."
NODE_ENV=production npx ts-node scripts/auto-migrate.ts

echo "Build and database sync completed!"