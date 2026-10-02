#!/bin/bash
set -e

if [ ! -x "$(command -v node)" ] || [ ! -x "$(command -v npm)" ]; then
  echo "Node.js and npm are not installed. Installing them first..."
  DEBIAN_FRONTEND=noninteractive apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install nodejs npm -y
fi

if [ -x "$(command -v opencode)" ]; then
  echo "OpenCode is already installed. Skipping installation."
  exit 0
else
	npm install -g opencode-ai
fi
echo "✅ OpenCode Install Done"

### End of File
