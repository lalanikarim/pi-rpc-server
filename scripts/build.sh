#!/bin/bash
set -e

echo "Building TypeScript to JavaScript..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build TypeScript to JavaScript
npm run build

echo "Build complete!"
