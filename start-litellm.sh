#!/bin/bash
cd /www/wwwroot/copilot.synetal.com
export DATABASE_URL="postgresql://litellm:litellm123@localhost:5432/litellm"
export LITELLM_MASTER_KEY="sk-litellm-fixed-master-key-2026"
exec litellm --config litellm-config-minimal.yaml --port 4002 --host 0.0.0.0
