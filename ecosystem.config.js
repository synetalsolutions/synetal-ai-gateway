module.exports = {
  apps: [
    {
      name: 'multi-model-proxy',
      script: './dist/index.js',
      cwd: '/www/wwwroot/copilot.synetal.com',
      env: {
        NODE_ENV: 'production',
        HEADROOM_ENABLED: 'false',
        PROXY_PORT: '3456',
        PROXY_API_KEY: 'REDACTED-PROXY-KEY',
        RATE_LIMIT_RPM: '500',
        PREPROCESS_ENABLED: 'true',
        PREPROCESS_MODEL: 'deepseek-v4-flash'
      },
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      log_file: '/tmp/proxy-combined.log',
      out_file: '/tmp/proxy-out.log',
      error_file: '/tmp/proxy-error.log'
    },
    {
      name: 'litellm-proxy',
      script: './start-litellm.sh',
      cwd: '/www/wwwroot/copilot.synetal.com',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_file: '/tmp/litellm-combined.log',
      out_file: '/tmp/litellm-out.log',
      error_file: '/tmp/litellm-error.log'
    }
  ]
};
