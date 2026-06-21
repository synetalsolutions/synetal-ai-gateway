module.exports = {
  apps: [
    {
      name: 'multi-model-proxy',
      script: './dist/index.js',
      cwd: '/www/wwwroot/copilot.synetal.com',
      env: {
        NODE_ENV: 'production',
        PROXY_PORT: '3456',
        PROXY_API_KEY: 'REDACTED-PROXY-KEY',
      },
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      log_file: '/tmp/proxy-combined.log',
      out_file: '/tmp/proxy-out.log',
      error_file: '/tmp/proxy-error.log'
    }
  ]
};
